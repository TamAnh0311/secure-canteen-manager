"""Durable at-least-once callback delivery using immutable outbox bytes."""

from __future__ import annotations

import random
import ssl
import urllib.error
import urllib.request
from collections.abc import Callable, Mapping
from dataclasses import dataclass
from datetime import UTC, datetime
from email.utils import parsedate_to_datetime
from typing import Protocol
from urllib.parse import urlsplit

from order_scanner.config import SecretValue
from order_scanner.storage import ClaimedOutbox, Storage


@dataclass(frozen=True, slots=True)
class DeliveryResponse:
    status_code: int
    headers: Mapping[str, str]


class CallbackTransport(Protocol):
    def send(
        self,
        *,
        url: str,
        token: SecretValue,
        event: ClaimedOutbox,
        timeout_seconds: float,
    ) -> DeliveryResponse: ...


class UrllibCallbackTransport:
    """HTTPS transport that refuses redirects so bearer tokens stay on one origin."""

    def __init__(self) -> None:
        context = ssl.create_default_context()
        context.minimum_version = ssl.TLSVersion.TLSv1_2
        self._opener = urllib.request.build_opener(
            # The scanner must not inherit a process-wide proxy that could
            # receive the callback bearer token.
            urllib.request.ProxyHandler({}),
            _NoRedirect(),
            urllib.request.HTTPSHandler(context=context),
        )

    def send(
        self,
        *,
        url: str,
        token: SecretValue,
        event: ClaimedOutbox,
        timeout_seconds: float,
    ) -> DeliveryResponse:
        request = urllib.request.Request(
            url,
            data=event.payload,
            method="POST",
            headers={
                "Authorization": f"Bearer {token.reveal()}",
                "Content-Type": "application/json; charset=utf-8",
                "Idempotency-Key": event.idempotency_key,
                "User-Agent": "order-scanner/0.1",
            },
        )
        try:
            with self._opener.open(request, timeout=timeout_seconds) as response:
                return DeliveryResponse(
                    int(response.status),
                    {key.casefold(): value for key, value in response.headers.items()},
                )
        except urllib.error.HTTPError as exc:
            return DeliveryResponse(
                int(exc.code),
                {key.casefold(): value for key, value in exc.headers.items()},
            )


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(
        self,
        req: urllib.request.Request,
        fp: object,
        code: int,
        msg: str,
        headers: object,
        newurl: str,
    ) -> None:
        return None


@dataclass(frozen=True, slots=True)
class RetryPolicy:
    base_delay_seconds: float = 2.0
    max_delay_seconds: float = 300.0

    def __post_init__(self) -> None:
        if self.base_delay_seconds <= 0 or self.max_delay_seconds < self.base_delay_seconds:
            raise ValueError("callback retry delays are invalid")

    def delay(
        self,
        *,
        attempt_count: int,
        retry_after: str | None,
        now: datetime,
        random_value: float,
    ) -> float:
        server_delay = _retry_after_seconds(retry_after, now)
        if server_delay is not None:
            return min(self.max_delay_seconds, server_delay)
        ceiling = min(
            self.max_delay_seconds,
            self.base_delay_seconds * (2 ** max(0, attempt_count - 1)),
        )
        return float(ceiling) * min(1.0, max(0.0, random_value))


class CallbackDispatcher:
    def __init__(
        self,
        *,
        storage: Storage,
        url: str,
        token: SecretValue,
        lease_seconds: int,
        timeout_seconds: float,
        payload_max_bytes: int,
        retry_policy: RetryPolicy | None = None,
        transport: CallbackTransport | None = None,
        clock: Callable[[], datetime] = lambda: datetime.now(UTC),
        random_value: Callable[[], float] = random.random,
    ) -> None:
        if lease_seconds < 1 or timeout_seconds <= 0 or payload_max_bytes < 1:
            raise ValueError("callback dispatcher limits are invalid")
        _validate_callback_url(url)
        self.storage = storage
        self.url = url
        self.token = token
        self.lease_seconds = lease_seconds
        self.timeout_seconds = timeout_seconds
        self.payload_max_bytes = payload_max_bytes
        self.retry_policy = retry_policy or RetryPolicy()
        self.transport = transport or UrllibCallbackTransport()
        self.clock = clock
        self.random_value = random_value

    def deliver_once(self, *, worker_id: str) -> bool:
        event = self.storage.claim_outbox(
            worker_id=worker_id, lease_seconds=self.lease_seconds
        )
        if event is None:
            return False
        if len(event.payload) > self.payload_max_bytes:
            self.storage.block_outbox(
                event_id=event.event_id,
                worker_id=worker_id,
                lease_epoch=event.lease_epoch,
                status_code=None,
                error_code="payload_too_large",
            )
            return True
        try:
            response = self.transport.send(
                url=self.url,
                token=self.token,
                event=event,
                timeout_seconds=self.timeout_seconds,
            )
        except (OSError, TimeoutError, urllib.error.URLError):
            self._retry(event, worker_id, None, "transport_error", None)
            return True

        status = response.status_code
        if 200 <= status < 300:
            self.storage.mark_outbox_delivered(
                event_id=event.event_id,
                worker_id=worker_id,
                lease_epoch=event.lease_epoch,
                status_code=status,
            )
        elif status in {408, 425, 429} or 500 <= status < 600:
            self._retry(
                event,
                worker_id,
                status,
                f"http_{status}",
                response.headers.get("retry-after"),
            )
        else:
            self.storage.block_outbox(
                event_id=event.event_id,
                worker_id=worker_id,
                lease_epoch=event.lease_epoch,
                status_code=status,
                error_code=f"http_{status}",
            )
        return True

    def _retry(
        self,
        event: ClaimedOutbox,
        worker_id: str,
        status_code: int | None,
        error_code: str,
        retry_after: str | None,
    ) -> None:
        delay = self.retry_policy.delay(
            attempt_count=event.attempt_count,
            retry_after=retry_after,
            now=self.clock(),
            random_value=self.random_value(),
        )
        self.storage.schedule_outbox_retry(
            event_id=event.event_id,
            worker_id=worker_id,
            lease_epoch=event.lease_epoch,
            delay_seconds=delay,
            status_code=status_code,
            error_code=error_code,
        )


def _retry_after_seconds(value: str | None, now: datetime) -> float | None:
    if value is None:
        return None
    stripped = value.strip()
    if stripped.isdecimal():
        return float(stripped)
    try:
        target = parsedate_to_datetime(stripped)
    except (TypeError, ValueError, OverflowError):
        return None
    if target.tzinfo is None:
        target = target.replace(tzinfo=UTC)
    return max(0.0, (target.astimezone(UTC) - now.astimezone(UTC)).total_seconds())


def _validate_callback_url(value: str) -> None:
    try:
        parsed = urlsplit(value)
        _port = parsed.port
    except ValueError:
        raise ValueError("callback URL is invalid") from None
    hostname = parsed.hostname.casefold() if parsed.hostname else None
    loopback_http = parsed.scheme == "http" and hostname in {"localhost", "127.0.0.1", "::1"}
    if (
        parsed.scheme != "https" and not loopback_http
        or not parsed.hostname
        or parsed.username
        or parsed.password
        or parsed.query
        or parsed.fragment
    ):
        raise ValueError(
            "callback URL must be HTTPS, or HTTP for an exact loopback "
            "development endpoint, without credentials or query data"
        )
