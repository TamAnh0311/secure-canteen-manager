"""Authenticated artifact streaming and small service health endpoints."""

from __future__ import annotations

import hmac
import json
import ssl
import threading
from collections.abc import Callable
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path, PurePosixPath
from typing import Any
from urllib.parse import unquote, urlsplit

from order_scanner.artifacts import ArtifactStoreError, ImmutableFileStore
from order_scanner.config import SecretValue
from order_scanner.storage import Storage

Readiness = Callable[[], tuple[bool, str]]
Metrics = Callable[[], str]


class ArtifactApiServer:
    def __init__(
        self,
        *,
        storage: Storage,
        artifact_root: str | Path,
        artifact_token: SecretValue | None,
        bind_host: str = "127.0.0.1",
        port: int = 0,
        readiness: Readiness | None = None,
        metrics: Metrics | None = None,
        tls_context: ssl.SSLContext | None = None,
    ) -> None:
        self.storage = storage
        self.store = ImmutableFileStore(artifact_root)
        self.artifact_token = artifact_token
        self.readiness = readiness or (lambda: (True, "ready"))
        self.metrics = metrics or (lambda: "# no metrics\n")
        self._server = ThreadingHTTPServer(
            (bind_host, port),
            _handler_type(storage, self.store, artifact_token, self.readiness, self.metrics),
        )
        if tls_context is not None:
            self._server.socket = tls_context.wrap_socket(
                self._server.socket, server_side=True
            )
        self._thread: threading.Thread | None = None

    @property
    def address(self) -> tuple[str, int]:
        host, port = self._server.server_address[:2]
        return str(host), int(port)

    def start(self) -> None:
        if self._thread is not None:
            raise RuntimeError("artifact API is already running")
        self._thread = threading.Thread(
            target=self._server.serve_forever,
            name="artifact-api",
            daemon=True,
        )
        self._thread.start()

    def stop(self) -> None:
        if self._thread is None:
            return
        self._server.shutdown()
        self._server.server_close()
        self._thread.join(timeout=5)
        self._thread = None


def build_tls_context(cert_file: str | Path, key_file: str | Path) -> ssl.SSLContext:
    context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    context.minimum_version = ssl.TLSVersion.TLSv1_2
    context.load_cert_chain(certfile=str(cert_file), keyfile=str(key_file))
    return context


def _handler_type(
    storage: Storage,
    store: ImmutableFileStore,
    token: SecretValue | None,
    readiness: Readiness,
    metrics: Metrics,
) -> type[BaseHTTPRequestHandler]:
    class Handler(BaseHTTPRequestHandler):
        server_version = "order-scanner-api/0.1"

        def do_GET(self) -> None:  # noqa: N802
            self._dispatch(head=False)

        def do_HEAD(self) -> None:  # noqa: N802
            self._dispatch(head=True)

        def _dispatch(self, *, head: bool) -> None:
            parsed = urlsplit(self.path)
            path = unquote(parsed.path)
            if path == "/live":
                _json_response(self, HTTPStatus.OK, {"status": "live"}, head=head)
                return
            if path == "/ready":
                ready, reason = readiness()
                _json_response(
                    self,
                    HTTPStatus.OK if ready else HTTPStatus.SERVICE_UNAVAILABLE,
                    {"status": "ready" if ready else "not_ready", "reason": reason},
                    head=head,
                )
                return
            if path == "/metrics":
                if not _authorized(self, token):
                    _unauthorized(self, head=head)
                    return
                body = metrics().encode("utf-8")
                _bytes_response(self, HTTPStatus.OK, body, "text/plain; version=0.0.4", head)
                return
            prefix = "/artifacts/"
            if path.startswith(prefix) and path[len(prefix) :]:
                if not _authorized(self, token):
                    _unauthorized(self, head=head)
                    return
                _serve_artifact(self, storage, store, path[len(prefix) :], head=head)
                return
            _json_response(self, HTTPStatus.NOT_FOUND, {"error": "not_found"}, head=head)

        def log_message(self, _format: str, *_args: object) -> None:
            return

    return Handler


def _authorized(handler: BaseHTTPRequestHandler, token: SecretValue | None) -> bool:
    if token is None:
        return False
    value = handler.headers.get("Authorization", "")
    if not value.startswith("Bearer "):
        return False
    supplied = value[7:]
    return hmac.compare_digest(supplied.encode("utf-8"), token.reveal().encode("utf-8"))


def _unauthorized(handler: BaseHTTPRequestHandler, *, head: bool) -> None:
    handler.send_response(HTTPStatus.UNAUTHORIZED)
    handler.send_header("WWW-Authenticate", "Bearer")
    handler.send_header("Content-Length", "0")
    handler.end_headers()


def _serve_artifact(
    handler: BaseHTTPRequestHandler,
    storage: Storage,
    store: ImmutableFileStore,
    artifact_id: str,
    *,
    head: bool,
) -> None:
    artifact = storage.artifact(artifact_id)
    if artifact is None:
        _json_response(handler, HTTPStatus.NOT_FOUND, {"error": "not_found"}, head=head)
        return
    try:
        path = _safe_path(store.root, artifact.relative_path)
        store.verify_relative(artifact.relative_path, artifact.sha256, artifact.byte_size)
        total = artifact.byte_size
        try:
            start, end, partial = _range(handler.headers.get("Range"), total)
        except (ValueError, IndexError):
            handler.send_response(HTTPStatus.REQUESTED_RANGE_NOT_SATISFIABLE)
            handler.send_header("Content-Range", f"bytes */{total}")
            handler.send_header("Content-Length", "0")
            handler.end_headers()
            return
        if partial:
            status = HTTPStatus.PARTIAL_CONTENT
        else:
            status = HTTPStatus.OK
            start, end = 0, total - 1
        length = max(0, end - start + 1)
        handler.send_response(status)
        handler.send_header("Content-Type", artifact.media_type or "application/octet-stream")
        handler.send_header("Content-Length", str(length))
        handler.send_header("Accept-Ranges", "bytes")
        handler.send_header("Cache-Control", "no-store")
        if partial:
            handler.send_header("Content-Range", f"bytes {start}-{end}/{total}")
        handler.end_headers()
        if head:
            return
        with path.open("rb") as handle:
            handle.seek(start)
            remaining = length
            while remaining:
                chunk = handle.read(min(1024 * 1024, remaining))
                if not chunk:
                    break
                handler.wfile.write(chunk)
                remaining -= len(chunk)
    except (ArtifactStoreError, OSError):
        _json_response(handler, HTTPStatus.NOT_FOUND, {"error": "not_found"}, head=head)


def _range(value: str | None, total: int) -> tuple[int, int, bool]:
    if total < 1 or not value:
        return 0, max(0, total - 1), False
    if not value.startswith("bytes=") or "," in value:
        raise ValueError("only one byte range is supported")
    start_text, end_text = value[6:].split("-", 1)
    if not start_text:
        length = int(end_text)
        if length <= 0:
            raise ValueError("invalid byte range")
        return max(0, total - length), total - 1, True
    start = int(start_text)
    end = int(end_text) if end_text else total - 1
    if start < 0 or start >= total or end < start:
        raise ValueError("invalid byte range")
    return start, min(end, total - 1), True


def _safe_path(root: Path, relative_path: str) -> Path:
    relative = PurePosixPath(relative_path)
    if relative.is_absolute() or not relative.parts or ".." in relative.parts:
        raise ArtifactStoreError("artifact path is invalid")
    target = root.joinpath(*relative.parts)
    root_resolved = root.resolve()
    target_resolved = target.resolve()
    if root_resolved != target_resolved and root_resolved not in target_resolved.parents:
        raise ArtifactStoreError("artifact path escapes root")
    return target


def _json_response(
    handler: BaseHTTPRequestHandler,
    status: HTTPStatus,
    value: dict[str, Any],
    *,
    head: bool,
) -> None:
    body = json.dumps(value, sort_keys=True, separators=(",", ":")).encode("utf-8")
    _bytes_response(handler, status, body, "application/json", head)


def _bytes_response(
    handler: BaseHTTPRequestHandler,
    status: HTTPStatus,
    body: bytes,
    media_type: str,
    head: bool,
) -> None:
    handler.send_response(status)
    handler.send_header("Content-Type", media_type)
    handler.send_header("Content-Length", str(len(body)))
    handler.send_header("Cache-Control", "no-store")
    handler.end_headers()
    if not head:
        handler.wfile.write(body)
