from collections.abc import Callable
from datetime import UTC, datetime, timedelta
from pathlib import Path

from order_scanner.callbacks import CallbackDispatcher, DeliveryResponse
from order_scanner.config import SecretValue
from order_scanner.contracts import (
    CallbackEvent,
    FieldResult,
    PipelineVersions,
    ResultOutcome,
    ResultSnapshot,
    SourceReference,
    result_id,
)
from order_scanner.storage import ClaimedOutbox, Storage


def _seed(
    tmp_path: Path, *, clock: Callable[[], datetime]
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
        bundle_fingerprint="a" * 64,
    )
    job = storage.claim_job(worker_id="processor", lease_seconds=300)
    assert job is not None
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
            "a" * 64, "1", "1.0-draft", "ticket-v4", "none", "none", "none", "cat-1"
        ),
        completed_at=clock(),
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


def test_restart_reclaims_callback_lease_and_keeps_payload(tmp_path: Path) -> None:
    current = [datetime(2026, 1, 1, tzinfo=UTC)]
    storage, callback = _seed(tmp_path, clock=lambda: current[0])
    claimed = storage.claim_outbox(worker_id="crashed", lease_seconds=5)
    assert claimed is not None
    current[0] += timedelta(seconds=6)
    assert storage.recover_expired_outbox_leases() == 1

    transport = _Transport()
    dispatcher = CallbackDispatcher(
        storage=storage,
        url="https://callback.example.test/result",
        token=SecretValue("secret"),
        lease_seconds=30,
        timeout_seconds=2,
        payload_max_bytes=100_000,
        transport=transport,
        clock=lambda: current[0],
    )
    assert dispatcher.deliver_once(worker_id="restarted")
    row = storage.outbox_row(callback.event_id)
    assert row is not None
    assert row["state"] == "delivered"
    assert transport.payload == callback.to_json_bytes()


class _Transport:
    payload: bytes | None = None

    def send(
        self,
        *,
        url: str,
        token: SecretValue,
        event: ClaimedOutbox,
        timeout_seconds: float,
    ) -> DeliveryResponse:
        del url, token, timeout_seconds
        self.payload = event.payload
        return DeliveryResponse(200, {})
