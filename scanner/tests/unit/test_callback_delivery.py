import urllib.request
from collections.abc import Callable
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any, cast

import pytest

from order_scanner.callbacks import (
    CallbackDispatcher,
    DeliveryResponse,
    RetryPolicy,
    UrllibCallbackTransport,
    _NoRedirect,
)
from order_scanner.config import SecretValue
from order_scanner.contracts import (
    CallbackEvent,
    FieldResult,
    PipelineVersions,
    ResultOutcome,
    ResultSnapshot,
    SourceReference,
    result_id,
    utc_now,
)
from order_scanner.storage import ClaimedOutbox, Storage

BUNDLE = "a" * 64


def test_real_transport_disables_proxy_inheritance_and_redirects(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    captured: list[object] = []

    def build_opener(*handlers: object) -> object:
        captured.extend(handlers)
        return object()

    monkeypatch.setattr(urllib.request, "build_opener", build_opener)
    UrllibCallbackTransport()

    proxy = cast(
        Any,
        next(
            handler
            for handler in captured
            if isinstance(handler, urllib.request.ProxyHandler)
        ),
    )
    assert proxy.proxies == {}
    redirect = next(handler for handler in captured if isinstance(handler, _NoRedirect))
    request = urllib.request.Request("https://scanner.example.test/result")
    assert (
        cast(
            object,
            redirect.redirect_request(
                request, object(), 302, "redirect", object(), "https://other.test"
            ),
        )
        is None
    )


class FakeTransport:
    def __init__(self, responses: list[DeliveryResponse | Exception]) -> None:
        self.responses = responses
        self.events: list[bytes] = []

    def send(
        self,
        *,
        url: str,
        token: SecretValue,
        event: ClaimedOutbox,
        timeout_seconds: float,
    ) -> DeliveryResponse:
        del url, token, timeout_seconds
        payload = event.payload
        self.events.append(payload)
        response = self.responses.pop(0)
        if isinstance(response, Exception):
            raise response
        return response


def _seed(
    tmp_path: Path,
    *,
    clock: Callable[[], datetime] = utc_now,
) -> tuple[Storage, CallbackEvent]:
    storage = Storage(
        tmp_path / "state.sqlite3", artifact_root=tmp_path / "artifacts", clock=clock
    )
    storage.migrate(Path(__file__).parents[2] / "migrations")
    source_digest = "b" * 64
    document = storage.create_source_document_job(
        source_identifier=f"src_{source_digest}",
        source_sha256=source_digest,
        byte_size=4,
        local_path="sources/b.bin",
        original_relative_path="capture.pdf",
        page_index=0,
        bundle_fingerprint=BUNDLE,
    )
    job = storage.claim_job(worker_id="processor", lease_seconds=300)
    assert job is not None
    completed = clock()
    result = ResultSnapshot(
        result_id=result_id(document.document_id, 1),
        document_id=document.document_id,
        page_index=0,
        revision=1,
        outcome=ResultOutcome.NEEDS_REVIEW,
        source=SourceReference(document.source_id),
        ma_luu_ky=FieldResult("ma_luu_ky", "000001", "000001", 0.9),
        buong_giam=FieldResult("buong_giam", "A1", "A1", 0.9),
        items=(),
        artifacts=(),
        warnings=(),
        versions=PipelineVersions(
            BUNDLE, "1", "1.0-draft", "ticket-v4", "none", "none", "none", "cat-1"
        ),
        completed_at=completed,
        service_date="2026-08-04",
    )
    callback = CallbackEvent.from_result(result)
    storage.complete_job(
        job_id=job.job_id,
        worker_id="processor",
        lease_epoch=job.lease_epoch,
        result=result,
        callback=callback,
    )
    return storage, callback


def test_retry_preserves_exact_payload_and_honours_retry_after(tmp_path: Path) -> None:
    storage, callback = _seed(tmp_path)
    transport = FakeTransport([DeliveryResponse(503, {"retry-after": "7"})])
    dispatcher = CallbackDispatcher(
        storage=storage,
        url="https://callback.example.test/result",
        token=SecretValue("secret"),
        lease_seconds=30,
        timeout_seconds=2,
        payload_max_bytes=100_000,
        retry_policy=RetryPolicy(1, 10),
        transport=transport,
        random_value=lambda: 0,
    )

    assert dispatcher.deliver_once(worker_id="callback")
    row = storage.outbox_row(callback.event_id)
    assert row is not None
    assert row["state"] == "retrying"
    assert row["last_error"] == "http_503"
    assert bytes(row["payload_json"]) == callback.to_json_bytes()
    assert transport.events == [callback.to_json_bytes()]


def test_retry_after_is_capped_by_local_retry_policy() -> None:
    now = datetime(2026, 1, 1, tzinfo=UTC)
    assert RetryPolicy(1, 10).delay(
        attempt_count=1,
        retry_after="999999999999999999999",
        now=now,
        random_value=0,
    ) == 10


def test_dispatcher_rejects_plaintext_callback_url(tmp_path: Path) -> None:
    storage, _callback = _seed(tmp_path)
    with pytest.raises(ValueError, match="HTTPS"):
        CallbackDispatcher(
            storage=storage,
            url="http://callback.example.test/result",
            token=SecretValue("secret"),
            lease_seconds=30,
            timeout_seconds=2,
            payload_max_bytes=100_000,
        )


def test_non_retryable_client_error_blocks_event(tmp_path: Path) -> None:
    storage, callback = _seed(tmp_path)
    dispatcher = CallbackDispatcher(
        storage=storage,
        url="https://callback.example.test/result",
        token=SecretValue("secret"),
        lease_seconds=30,
        timeout_seconds=2,
        payload_max_bytes=100_000,
        transport=FakeTransport([DeliveryResponse(422, {})]),
    )
    assert dispatcher.deliver_once(worker_id="callback")
    row = storage.outbox_row(callback.event_id)
    assert row is not None
    assert row["state"] == "blocked"
    assert row["last_error"] == "http_422"


def test_manual_replay_reuses_event_and_payload(tmp_path: Path) -> None:
    storage, callback = _seed(tmp_path)
    dispatcher = CallbackDispatcher(
        storage=storage,
        url="https://callback.example.test/result",
        token=SecretValue("secret"),
        lease_seconds=30,
        timeout_seconds=2,
        payload_max_bytes=100_000,
        transport=FakeTransport([DeliveryResponse(204, {}), DeliveryResponse(200, {})]),
    )
    assert dispatcher.deliver_once(worker_id="callback")
    storage.replay_outbox(callback.event_id)
    assert dispatcher.deliver_once(worker_id="callback")
    row = storage.outbox_row(callback.event_id)
    assert row is not None
    assert row["state"] == "delivered"
    assert bytes(row["payload_json"]) == callback.to_json_bytes()


def test_expired_callback_lease_is_reclaimed_with_same_payload(tmp_path: Path) -> None:
    current = [datetime(2026, 1, 1, tzinfo=UTC)]
    storage, callback = _seed(tmp_path, clock=lambda: current[0])
    first = storage.claim_outbox(worker_id="crashed", lease_seconds=5)
    assert first is not None
    current[0] += timedelta(seconds=6)
    assert storage.recover_expired_outbox_leases() == 1
    second = storage.claim_outbox(worker_id="restarted", lease_seconds=5)
    assert second is not None
    assert second.attempt_count == 2
    assert second.payload == callback.to_json_bytes()
