from __future__ import annotations

import hashlib
import sqlite3
import threading
import time
from dataclasses import replace
from datetime import UTC, datetime, timedelta
from pathlib import Path

import pytest

from order_scanner.contracts import (
    CallbackEvent,
    FieldResult,
    PipelineVersions,
    ResultOutcome,
    ResultSnapshot,
    SourceReference,
    result_id,
    source_id,
    utc_now,
)
from order_scanner.storage import (
    IngestedDocument,
    LeaseLostError,
    MigrationError,
    Storage,
    StorageError,
    _validate_relative_path,
)

NOW = datetime(2026, 8, 3, 0, 0, tzinfo=UTC)
BUNDLE = "b" * 64


class ControlledClock:
    def __init__(self, current: datetime) -> None:
        self.current = current

    def __call__(self) -> datetime:
        return self.current

    def set(self, current: datetime) -> None:
        self.current = current


class ControlledStorage(Storage):
    __test__ = False

    def __init__(self, database_path: Path) -> None:
        self.clock = ControlledClock(NOW)
        super().__init__(
            database_path,
            artifact_root=database_path.parent / "artifacts",
            clock=self.clock,
        )


def _storage(tmp_path: Path) -> ControlledStorage:
    storage = ControlledStorage(tmp_path / "state.sqlite3")
    storage.migrate(Path(__file__).parents[2] / "migrations")
    return storage


def _add(
    storage: Storage, *, page_index: int = 0, bundle: str = BUNDLE
) -> IngestedDocument:
    raw = f"scan-{page_index}".encode()
    digest = hashlib.sha256(raw).hexdigest()
    return storage.create_source_document_job(
        source_identifier=source_id(raw),
        source_sha256=digest,
        byte_size=len(raw),
        local_path=f"spool/{page_index}.bin",
        original_relative_path=f"batch/{page_index}.png",
        page_index=page_index,
        bundle_fingerprint=bundle,
    )


def _result(
    document: IngestedDocument,
    *,
    page_index: int = 0,
    revision: int = 1,
    source_identifier: str | None = None,
    bundle: str = BUNDLE,
) -> ResultSnapshot:
    return ResultSnapshot(
        result_id=result_id(document.document_id, revision),
        document_id=document.document_id,
        page_index=page_index,
        revision=revision,
        outcome=ResultOutcome.ACCEPTED,
        source=SourceReference(source_identifier or document.source_id),
        ma_luu_ky=FieldResult("ma_luu_ky", "000001", "000001", 0.99),
        buong_giam=FieldResult("buong_giam", "A1", "A1", 0.99),
        items=(),
        artifacts=(),
        warnings=(),
        versions=PipelineVersions(
            bundle, "1", "1.0-draft", "ticket-v4", "none", "none", "none", "catalogue-1"
        ),
        completed_at=NOW,
        service_date="2026-08-04",
    )


def test_migrations_are_idempotent_and_exact_duplicate_is_reused(tmp_path: Path) -> None:
    storage = _storage(tmp_path)
    first = _add(storage)
    storage.migrate(Path(__file__).parents[2] / "migrations")
    second = _add(storage)

    assert first.source_id == second.source_id
    assert first.document_id == second.document_id
    assert first.job_id == second.job_id
    assert second.duplicate is True
    assert storage.status_counts() == {"queued": 1}


def test_phase_two_migration_preserves_legacy_shared_artifact_paths(tmp_path: Path) -> None:
    repository_migrations = Path(__file__).parents[2] / "migrations"
    upgrade_migrations = tmp_path / "upgrade-migrations"
    upgrade_migrations.mkdir()
    (upgrade_migrations / "001-initial.sql").write_bytes(
        (repository_migrations / "001-initial.sql").read_bytes()
    )
    storage = ControlledStorage(tmp_path / "upgrade.sqlite3")
    storage.migrate(upgrade_migrations)
    with sqlite3.connect(storage.database_path) as connection:
        for index in range(2):
            source = f"src_{index}"
            document = f"doc_{index}"
            job = f"job_{index}"
            connection.execute(
                "INSERT INTO source_files VALUES (?, ?, 1, ?, 'copied', ?, ?)",
                (source, f"{index}" * 64, f"sources/{index}.bin", "now", "now"),
            )
            connection.execute(
                "INSERT INTO documents VALUES (?, ?, 0, ?)",
                (document, source, "now"),
            )
            connection.execute(
                """
                INSERT INTO jobs(job_id, document_id, bundle_fingerprint, state,
                    available_at, created_at, updated_at)
                VALUES (?, ?, ?, 'queued', ?, ?, ?)
                """,
                (job, document, BUNDLE, "now", "now", "now"),
            )
            connection.execute(
                """
                INSERT INTO artifacts VALUES (?, ?, 'review-crop', ?, 'image/png',
                    ?, 4, 1, 1, ?)
                """,
                (f"artifact-{index}", job, "shared/crop.png", f"{index + 2}" * 64, "now"),
            )
    (upgrade_migrations / "002-ingestion-and-artifact-provenance.sql").write_bytes(
        (repository_migrations / "002-ingestion-and-artifact-provenance.sql").read_bytes()
    )

    storage.migrate(upgrade_migrations)

    with sqlite3.connect(storage.database_path) as connection:
        assert connection.execute("SELECT COUNT(*) FROM artifacts").fetchone()[0] == 2


def test_batch_page_creation_and_ingestion_rejection_are_durable(tmp_path: Path) -> None:
    storage = _storage(tmp_path)
    pages = storage.create_source_documents_jobs(
        source_identifier=source_id(b"batch"),
        source_sha256=hashlib.sha256(b"batch").hexdigest(),
        byte_size=5,
        local_path="sources/ba/batch.bin",
        original_relative_path="batch.tiff",
        page_indexes=(0, 1),
        bundle_fingerprint=BUNDLE,
        ingestion_receipt_id="ing_receipt-1",
    )
    storage.record_ingestion_rejection(
        rejection_id="rej-1",
        original_relative_path="bad.pdf",
        reason_code="encrypted_pdf",
        detail="encrypted PDF inputs are not supported",
        byte_size=12,
        modified_time_ns=123,
    )

    assert len(pages) == 2
    assert storage.status_counts() == {"queued": 2}
    assert storage.ingestion_rejections()[0]["reason_code"] == "encrypted_pdf"


def test_visual_fingerprint_reports_probable_duplicates_without_suppressing_jobs(
    tmp_path: Path,
) -> None:
    storage = _storage(tmp_path)
    first = _add(storage, page_index=0)
    second = _add(storage, page_index=1)

    assert storage.record_visual_fingerprint(
        document_id=first.document_id, fingerprint="0" * 16
    ) == ()
    matches = storage.record_visual_fingerprint(
        document_id=second.document_id, fingerprint="0" * 16
    )

    assert matches == (type(matches[0])(first.document_id, 0),)
    assert storage.status_counts() == {"queued": 2}


def test_artifact_provenance_columns_are_recorded(tmp_path: Path) -> None:
    storage = _storage(tmp_path)
    _add(storage)
    claim = storage.claim_job(worker_id="worker-a", lease_seconds=30)
    assert claim is not None
    artifact_path = tmp_path / "artifacts" / "crops" / "artifact-1.png"
    artifact_path.parent.mkdir(parents=True)
    artifact_path.write_bytes(b"crop")
    storage.record_artifact(
        artifact_id="artifact-1",
        job_id=claim.job_id,
        worker_id="worker-a",
        lease_epoch=claim.lease_epoch,
        kind="review-crop",
        relative_path="crops/artifact-1.png",
        media_type="image/png",
        sha256=hashlib.sha256(b"crop").hexdigest(),
        byte_size=4,
        page_index=0,
        field_name="items.0.name",
        row_index=0,
        template_version="ticket-v4",
    )

    with sqlite3.connect(storage.database_path) as connection:
        row = connection.execute(
            "SELECT page_index, field_name, row_index, template_version FROM artifacts"
        ).fetchone()
    assert row == (0, "items.0.name", 0, "ticket-v4")


def test_document_cannot_be_rebound_to_a_second_pipeline_bundle(tmp_path: Path) -> None:
    storage = _storage(tmp_path)
    _add(storage, bundle="a" * 64)
    with pytest.raises(StorageError, match="different pipeline bundle"):
        _add(storage, bundle="b" * 64)
    assert storage.status_counts() == {"queued": 1}


def test_expired_lease_is_requeued_and_stale_worker_is_fenced(tmp_path: Path) -> None:
    storage = _storage(tmp_path)
    document = _add(storage)
    first = storage.claim_job(worker_id="worker-a", lease_seconds=30)
    assert first is not None
    storage.clock.set(NOW + timedelta(seconds=31))
    assert storage.recover_expired_leases() == 1
    storage.clock.set(NOW + timedelta(seconds=32))
    second = storage.claim_job(
        worker_id="worker-b", lease_seconds=30
    )
    assert second is not None
    with pytest.raises(LeaseLostError):
        storage.complete_job(
            job_id=first.job_id,
            worker_id="worker-a",
            lease_epoch=first.lease_epoch,
            result=_result(document),
            callback=CallbackEvent.from_result(_result(document)),
        )
    event_id = CallbackEvent.from_result(_result(document)).event_id
    assert storage.outbox_row(event_id) is None


def test_job_attempts_become_permanent_at_configured_bound(tmp_path: Path) -> None:
    storage = _storage(tmp_path)
    _add(storage)

    first = storage.claim_job(worker_id="worker-a", lease_seconds=30, max_attempts=2)
    assert first is not None
    storage.fail_job(
        job_id=first.job_id,
        worker_id="worker-a",
        lease_epoch=first.lease_epoch,
        error_code="temporary_failure",
        retryable=True,
        max_attempts=2,
    )
    second = storage.claim_job(worker_id="worker-b", lease_seconds=30, max_attempts=2)
    assert second is not None
    storage.fail_job(
        job_id=second.job_id,
        worker_id="worker-b",
        lease_epoch=second.lease_epoch,
        error_code="temporary_failure",
        retryable=True,
        max_attempts=2,
    )

    assert storage.status_counts() == {"failed_permanent": 1}
    assert storage.claim_job(worker_id="worker-c", lease_seconds=30, max_attempts=2) is None


def test_expired_lease_at_attempt_bound_becomes_permanent(tmp_path: Path) -> None:
    storage = _storage(tmp_path)
    _add(storage)
    claim = storage.claim_job(worker_id="worker-a", lease_seconds=1, max_attempts=1)
    assert claim is not None
    storage.clock.set(NOW + timedelta(seconds=2))

    assert storage.recover_expired_leases(max_attempts=1) == 1
    assert storage.status_counts() == {"failed_permanent": 1}


def test_result_and_outbox_are_atomic(tmp_path: Path) -> None:
    storage = _storage(tmp_path)
    first_document = _add(storage)
    first_claim = storage.claim_job(worker_id="worker-a", lease_seconds=30)
    assert first_claim is not None
    first_result = _result(first_document)
    storage.complete_job(
        job_id=first_claim.job_id,
        worker_id="worker-a",
        lease_epoch=first_claim.lease_epoch,
        result=first_result,
        callback=CallbackEvent.from_result(first_result),
    )

    second_document = _add(storage, page_index=1)
    second_claim = storage.claim_job(worker_id="worker-b", lease_seconds=30)
    assert second_claim is not None
    second_result = _result(second_document, page_index=1)
    second_event = CallbackEvent.from_result(second_result)
    with sqlite3.connect(storage.database_path) as connection:
        connection.execute(
            f"""
            CREATE TRIGGER fail_selected_outbox
            BEFORE INSERT ON outbox
            WHEN NEW.event_id = '{second_event.event_id}'
            BEGIN
                SELECT RAISE(ABORT, 'forced outbox failure');
            END
            """
        )
    with pytest.raises(StorageError, match="constraint"):
        storage.complete_job(
            job_id=second_claim.job_id,
            worker_id="worker-b",
            lease_epoch=second_claim.lease_epoch,
            result=second_result,
            callback=second_event,
        )
    assert storage.status_counts() == {"completed": 1, "processing": 1}
    with sqlite3.connect(storage.database_path) as connection:
        result_count = connection.execute(
            "SELECT COUNT(*) FROM results WHERE job_id=?", (second_claim.job_id,)
        ).fetchone()[0]
        outbox_count = connection.execute(
            "SELECT COUNT(*) FROM outbox WHERE job_id=?", (second_claim.job_id,)
        ).fetchone()[0]
    assert (result_count, outbox_count) == (0, 0)


def test_fractional_lease_timestamps_are_ordered_correctly(tmp_path: Path) -> None:
    storage = _storage(tmp_path)
    _add(storage)
    fractional_start = NOW + timedelta(microseconds=500_000)
    storage.clock.set(fractional_start)
    fractional_claim = storage.claim_job(worker_id="worker-a", lease_seconds=30)
    assert fractional_claim is not None
    storage.clock.set(NOW + timedelta(seconds=30))
    assert storage.recover_expired_leases() == 0
    storage.clock.set(NOW + timedelta(seconds=30, microseconds=500_000))
    assert (
        storage.recover_expired_leases() == 1
    )

    exact_storage = _storage(tmp_path / "exact")
    exact_document = _add(exact_storage)
    exact_claim = exact_storage.claim_job(worker_id="worker-b", lease_seconds=30)
    assert exact_claim is not None
    exact_result = _result(exact_document)
    exact_storage.clock.set(NOW + timedelta(seconds=30, microseconds=500_000))
    with pytest.raises(LeaseLostError):
        exact_storage.complete_job(
            job_id=exact_claim.job_id,
            worker_id="worker-b",
            lease_epoch=exact_claim.lease_epoch,
            result=exact_result,
            callback=CallbackEvent.from_result(exact_result),
        )


def test_completion_binds_source_page_bundle_and_deterministic_ids(tmp_path: Path) -> None:
    storage = _storage(tmp_path)
    document = _add(storage, page_index=3)
    claim = storage.claim_job(worker_id="worker-a", lease_seconds=30)
    assert claim is not None
    valid = _result(document, page_index=3)

    bad_source = replace(valid, source=SourceReference("src_forged"))
    with pytest.raises(StorageError, match="source"):
        storage.complete_job(
            job_id=claim.job_id,
            worker_id="worker-a",
            lease_epoch=claim.lease_epoch,
            result=bad_source,
            callback=CallbackEvent.from_result(bad_source),
        )

    bad_page = replace(valid, page_index=0)
    with pytest.raises(StorageError, match="page index"):
        storage.complete_job(
            job_id=claim.job_id,
            worker_id="worker-a",
            lease_epoch=claim.lease_epoch,
            result=bad_page,
            callback=CallbackEvent.from_result(bad_page),
        )

    bad_result_id = replace(valid, result_id="res_forged")
    with pytest.raises(StorageError, match="result_id"):
        storage.complete_job(
            job_id=claim.job_id,
            worker_id="worker-a",
            lease_epoch=claim.lease_epoch,
            result=bad_result_id,
            callback=CallbackEvent.from_result(bad_result_id),
        )

    valid_event = CallbackEvent.from_result(valid)
    storage.complete_job(
        job_id=claim.job_id,
        worker_id="worker-a",
        lease_epoch=claim.lease_epoch,
        result=valid,
        callback=valid_event,
    )
    assert storage.outbox_row(valid_event.event_id) is not None


def test_failed_migration_rolls_back_all_statements(tmp_path: Path) -> None:
    migrations = tmp_path / "migrations"
    migrations.mkdir()
    (migrations / "001-broken.sql").write_text(
        "CREATE TABLE partial_write(id INTEGER);\nTHIS IS NOT SQL;\n",
        encoding="utf-8",
    )
    storage = Storage(tmp_path / "state.sqlite3")

    with pytest.raises(StorageError):
        storage.migrate(migrations)

    with sqlite3.connect(storage.database_path) as connection:
        partial_table = connection.execute(
            "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='partial_write'"
        ).fetchone()[0]
        applied = connection.execute("SELECT COUNT(*) FROM schema_migrations").fetchone()[0]
    assert (partial_table, applied) == (0, 0)


def test_applied_migration_must_remain_in_bundle(tmp_path: Path) -> None:
    storage = _storage(tmp_path)
    incomplete_bundle = tmp_path / "incomplete-migrations"
    incomplete_bundle.mkdir()
    (incomplete_bundle / "002-next.sql").write_text(
        "CREATE TABLE next_table(id INTEGER);\n", encoding="utf-8"
    )

    with pytest.raises(MigrationError, match="001.*missing"):
        storage.migrate(incomplete_bundle)


def test_completion_rechecks_lease_after_waiting_for_sqlite_lock(tmp_path: Path) -> None:
    storage = Storage(tmp_path / "state.sqlite3", clock=utc_now)
    storage.migrate(Path(__file__).parents[2] / "migrations")
    document = _add(storage)
    claim = storage.claim_job(worker_id="worker-a", lease_seconds=1)
    assert claim is not None
    holder = sqlite3.connect(
        storage.database_path, timeout=5, isolation_level=None, check_same_thread=False
    )
    holder.execute("BEGIN IMMEDIATE")
    release = threading.Event()

    def release_lock() -> None:
        time.sleep(1.2)
        holder.rollback()
        holder.close()
        release.set()

    thread = threading.Thread(target=release_lock)
    thread.start()
    result = _result(document)
    with pytest.raises(LeaseLostError):
        storage.complete_job(
            job_id=claim.job_id,
            worker_id="worker-a",
            lease_epoch=claim.lease_epoch,
            result=result,
            callback=CallbackEvent.from_result(result),
        )
    thread.join(timeout=5)
    assert release.is_set()


@pytest.mark.parametrize(
    "path",
    ["..\\outside\\x", "foo\\..\\x", "C:\\outside", "\\\\server\\share"],
)
def test_windows_relative_paths_reject_traversal_and_unc(path: str) -> None:
    with pytest.raises(StorageError, match="relative and traversal-free"):
        _validate_relative_path(path)
