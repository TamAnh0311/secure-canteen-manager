import hashlib
import urllib.error
import urllib.request
from pathlib import Path

import pytest

from order_scanner.api import ArtifactApiServer
from order_scanner.config import SecretValue
from order_scanner.storage import Storage


def _server(tmp_path: Path) -> tuple[ArtifactApiServer, str, bytes]:
    artifact_root = tmp_path / "artifacts"
    storage = Storage(tmp_path / "state.sqlite3", artifact_root=artifact_root)
    storage.migrate(Path(__file__).parents[2] / "migrations")
    source_digest = "b" * 64
    storage.create_source_document_job(
        source_identifier=f"src_{source_digest}",
        source_sha256=source_digest,
        byte_size=4,
        local_path="sources/b.bin",
        original_relative_path="capture.pdf",
        page_index=0,
        bundle_fingerprint="a" * 64,
    )
    job = storage.claim_job(worker_id="worker", lease_seconds=300)
    assert job is not None
    content = b"0123456789"
    relative_path = "crops/artifact-1.bin"
    path = artifact_root / relative_path
    path.parent.mkdir(parents=True)
    path.write_bytes(content)
    storage.record_artifact(
        artifact_id="artifact-1",
        job_id=job.job_id,
        worker_id="worker",
        lease_epoch=job.lease_epoch,
        kind="review-crop",
        relative_path=relative_path,
        media_type="application/octet-stream",
        sha256=hashlib.sha256(content).hexdigest(),
        byte_size=len(content),
        page_index=0,
        field_name="ma_luu_ky.0",
        template_version="ticket-v4",
    )
    server = ArtifactApiServer(
        storage=storage,
        artifact_root=artifact_root,
        artifact_token=SecretValue("artifact-secret"),
        metrics=lambda: "order_scanner_test 1\n",
    )
    server.start()
    host, port = server.address
    return server, f"http://{host}:{port}", content


def test_artifact_requires_separate_bearer_token_and_supports_ranges(tmp_path: Path) -> None:
    server, base_url, content = _server(tmp_path)
    try:
        with pytest.raises(urllib.error.HTTPError) as unauthorized:
            urllib.request.urlopen(f"{base_url}/artifacts/artifact-1", timeout=2)
        assert unauthorized.value.code == 401

        request = urllib.request.Request(
            f"{base_url}/artifacts/artifact-1",
            headers={"Authorization": "Bearer artifact-secret", "Range": "bytes=2-5"},
        )
        with urllib.request.urlopen(request, timeout=2) as response:
            assert response.status == 206
            assert response.read() == content[2:6]
            assert response.headers["Content-Range"] == "bytes 2-5/10"
    finally:
        server.stop()


def test_metrics_are_authenticated_but_liveness_is_minimal(tmp_path: Path) -> None:
    server, base_url, _content = _server(tmp_path)
    try:
        with urllib.request.urlopen(f"{base_url}/live", timeout=2) as response:
            assert response.status == 200
            assert response.read() == b'{"status":"live"}'
        with pytest.raises(urllib.error.HTTPError) as unauthorized:
            urllib.request.urlopen(f"{base_url}/metrics", timeout=2)
        assert unauthorized.value.code == 401
        request = urllib.request.Request(
            f"{base_url}/metrics",
            headers={"Authorization": "Bearer artifact-secret"},
        )
        with urllib.request.urlopen(request, timeout=2) as response:
            assert response.read() == b"order_scanner_test 1\n"
    finally:
        server.stop()
