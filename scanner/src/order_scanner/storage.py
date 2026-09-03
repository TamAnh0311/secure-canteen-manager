from __future__ import annotations

import hashlib
import json
import math
import re
import sqlite3
from collections.abc import Callable, Iterator
from contextlib import contextmanager
from dataclasses import dataclass
from datetime import UTC, date, datetime, timedelta
from pathlib import Path, PurePosixPath, PureWindowsPath
from typing import cast

from order_scanner.contracts import (
    CallbackEvent,
    JobState,
    OutboxState,
    ResultSnapshot,
    SourceState,
    callback_event_id,
    document_id,
    result_id,
    utc_now,
)


class StorageError(RuntimeError):
    """Durable state could not be read or written."""


class MigrationError(StorageError):
    """A migration is missing, malformed, or changed after application."""


class LeaseLostError(StorageError):
    """A worker no longer owns the job lease it tried to mutate."""


@dataclass(frozen=True, slots=True)
class ClaimedJob:
    job_id: str
    document_id: str
    bundle_fingerprint: str
    attempt_count: int
    lease_owner: str
    lease_epoch: int
    lease_expires_at: datetime


@dataclass(frozen=True, slots=True)
class ClaimedOutbox:
    event_id: str
    idempotency_key: str
    payload: bytes
    attempt_count: int
    lease_owner: str
    lease_epoch: int
    lease_expires_at: datetime


@dataclass(frozen=True, slots=True)
class StoredArtifact:
    artifact_id: str
    job_id: str
    kind: str
    relative_path: str
    media_type: str
    sha256: str
    byte_size: int
    page_index: int | None
    field_name: str | None
    row_index: int | None
    template_version: str | None


@dataclass(frozen=True, slots=True)
class ProcessingContext:
    job_id: str
    document_id: str
    bundle_fingerprint: str
    source_id: str
    source_sha256: str
    source_byte_size: int
    source_relative_path: str
    source_media_type: str
    service_date: str | None
    capture_id: str | None
    page_index: int
    preprocessing_disposition: str | None
    preprocessing_reason_code: str | None
    artifacts: tuple[StoredArtifact, ...]


@dataclass(frozen=True, slots=True)
class IngestedDocument:
    source_id: str
    document_id: str
    job_id: str
    duplicate: bool


@dataclass(frozen=True, slots=True)
class IngestionRejection:
    rejection_id: str
    reason_code: str
    detail: str


@dataclass(frozen=True, slots=True)
class VisualDuplicate:
    document_id: str
    distance: int


@dataclass(frozen=True, slots=True)
class IngestionArtifact:
    artifact_id: str
    kind: str
    relative_path: str
    media_type: str
    sha256: str
    byte_size: int
    pixel_width: int
    pixel_height: int
    page_index: int
    field_name: str
    row_index: int | None
    template_version: str


@dataclass(frozen=True, slots=True)
class PreprocessingDisposition:
    page_index: int
    disposition: str
    reason_code: str | None
    source_markers: tuple[tuple[float, float], ...]
    marker_size_cv: float | None
    reprojection_error_px: float | None
    template_version: str


class Storage:
    def __init__(
        self,
        database_path: str | Path,
        *,
        artifact_root: str | Path | None = None,
        busy_timeout_ms: int = 5_000,
        clock: Callable[[], datetime] = utc_now,
    ) -> None:
        self.database_path = Path(database_path)
        self.artifact_root = Path(artifact_root) if artifact_root is not None else None
        self.busy_timeout_ms = busy_timeout_ms
        self._clock = clock

    def migrate(self, migrations_dir: str | Path) -> None:
        migrations_path = Path(migrations_dir)
        files = sorted(migrations_path.glob("[0-9][0-9][0-9]-*.sql"))
        if not files:
            raise MigrationError(f"no SQL migrations found in {migrations_path}")
        with self._connection() as connection:
            connection.execute(
                """
                CREATE TABLE IF NOT EXISTS schema_migrations (
                    version INTEGER PRIMARY KEY,
                    name TEXT NOT NULL,
                    checksum TEXT NOT NULL,
                    applied_at TEXT NOT NULL
                )
                """
            )
            applied = {
                row[0]: (row[1], row[2])
                for row in connection.execute(
                    "SELECT version, name, checksum FROM schema_migrations ORDER BY version"
                )
            }
            file_versions = [int(migration.name[:3]) for migration in files]
            if len(file_versions) != len(set(file_versions)):
                raise MigrationError("migration bundle contains duplicate versions")
            missing_versions = sorted(set(applied) - set(file_versions))
            if missing_versions:
                raise MigrationError(
                    f"applied migration {missing_versions[0]:03d} is missing from the bundle"
                )
            for migration in files:
                version = int(migration.name[:3])
                checksum = hashlib.sha256(migration.read_bytes()).hexdigest()
                previous = applied.get(version)
                if previous is not None:
                    if previous != (migration.name, checksum):
                        raise MigrationError(
                            f"migration {migration.name} differs from its applied checksum"
                        )
                    continue
                if version != (max(applied) + 1 if applied else 1):
                    raise MigrationError(f"migration sequence has a gap before {migration.name}")
                connection.execute("BEGIN IMMEDIATE")
                self._execute_script(connection, migration.read_text(encoding="utf-8"))
                connection.execute(
                    "INSERT INTO schema_migrations(version, name, checksum, applied_at) "
                    "VALUES (?, ?, ?, ?)",
                    (version, migration.name, checksum, _timestamp(utc_now())),
                )
                connection.commit()
                applied[version] = (migration.name, checksum)

    def create_source_document_job(
        self,
        *,
        source_identifier: str,
        source_sha256: str,
        byte_size: int,
        local_path: str,
        original_relative_path: str,
        page_index: int,
        bundle_fingerprint: str,
        capture_id: str | None = None,
        source_media_type: str = "application/octet-stream",
    ) -> IngestedDocument:
        documents = self.create_source_documents_jobs(
            source_identifier=source_identifier,
            source_sha256=source_sha256,
            byte_size=byte_size,
            local_path=local_path,
            original_relative_path=original_relative_path,
            page_indexes=(page_index,),
            bundle_fingerprint=bundle_fingerprint,
            capture_id=capture_id,
            source_media_type=source_media_type,
        )
        return documents[0]

    def create_source_documents_jobs(
        self,
        *,
        source_identifier: str,
        source_sha256: str,
        byte_size: int,
        local_path: str,
        original_relative_path: str,
        page_indexes: tuple[int, ...],
        bundle_fingerprint: str,
        capture_id: str | None = None,
        source_media_type: str = "application/octet-stream",
        service_date: str | None = None,
        ingestion_receipt_id: str | None = None,
        observed_byte_size: int | None = None,
        observed_modified_time_ns: int | None = None,
        artifacts: tuple[IngestionArtifact, ...] = (),
        preprocessings: tuple[PreprocessingDisposition, ...] = (),
    ) -> tuple[IngestedDocument, ...]:
        if not page_indexes or len(page_indexes) != len(set(page_indexes)):
            raise StorageError("page_indexes must contain unique zero-based pages")
        if any(page_index < 0 for page_index in page_indexes):
            raise StorageError("page_indexes must be zero-based")
        if byte_size <= 0:
            raise StorageError("source byte_size must be positive")
        if not _is_sha256(source_sha256):
            raise StorageError("source_sha256 must be a lowercase SHA-256 digest")
        if source_identifier != f"src_{source_sha256}":
            raise StorageError("source_identifier must be derived from source_sha256")
        if not source_media_type or any(character.isspace() for character in source_media_type):
            raise StorageError("source_media_type must be a non-empty media type")
        if not _is_sha256(bundle_fingerprint):
            raise StorageError("bundle_fingerprint must be a lowercase SHA-256 digest")
        if service_date is not None:
            _validate_service_date(service_date)
        if (observed_byte_size is None) != (observed_modified_time_ns is None):
            raise StorageError("source observation size and mtime must be provided together")
        if observed_byte_size is not None and observed_byte_size < 0:
            raise StorageError("source observation size must not be negative")
        if observed_modified_time_ns is not None and observed_modified_time_ns < 0:
            raise StorageError("source observation mtime must not be negative")
        page_index_set = set(page_indexes)
        for artifact in artifacts:
            _validate_ingestion_artifact(artifact, page_index_set)
            self._verify_artifact_file(artifact.relative_path, artifact.sha256, artifact.byte_size)
        preprocessing_pages: set[int] = set()
        for preprocessing in preprocessings:
            _validate_preprocessing(preprocessing, page_index_set)
            if preprocessing.page_index in preprocessing_pages:
                raise StorageError("preprocessing pages must be unique")
            preprocessing_pages.add(preprocessing.page_index)
        _validate_relative_path(local_path)
        _validate_relative_path(original_relative_path)
        with self._connection() as connection:
            connection.execute("BEGIN IMMEDIATE")
            moment = self._clock()
            stamp = _timestamp(moment)
            existing_source = connection.execute(
                "SELECT sha256, byte_size, local_path, media_type, service_date "
                "FROM source_files WHERE source_id=?",
                (source_identifier,),
            ).fetchone()
            if existing_source is not None and (
                existing_source[0] != source_sha256
                or int(existing_source[1]) != byte_size
                or existing_source[2] != local_path
                or existing_source[3] != source_media_type
                or (
                    service_date is not None
                    and existing_source[4] is not None
                    and existing_source[4] != service_date
                )
            ):
                raise StorageError("source identity was reused with different bytes or path")
            connection.execute(
                """
                INSERT INTO source_files(
                    source_id, sha256, byte_size, local_path, media_type,
                    service_date, state, created_at, updated_at
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(source_id) DO UPDATE SET
                    service_date=COALESCE(source_files.service_date, excluded.service_date),
                    updated_at=excluded.updated_at
                """,
                (
                    source_identifier,
                    source_sha256,
                    byte_size,
                    local_path,
                    source_media_type,
                    service_date,
                    SourceState.COPIED,
                    stamp,
                    stamp,
                ),
            )
            if ingestion_receipt_id is None:
                connection.execute(
                    """
                    INSERT INTO source_discoveries(
                        source_id, original_relative_path, capture_id,
                        observed_byte_size, observed_modified_time_ns, discovered_at
                    ) VALUES (?, ?, ?, ?, ?, ?)
                    """,
                    (
                        source_identifier,
                        original_relative_path,
                        capture_id,
                        observed_byte_size,
                        observed_modified_time_ns,
                        stamp,
                    ),
                )
            else:
                connection.execute(
                    """
                    INSERT OR IGNORE INTO source_discoveries(
                        source_id, original_relative_path, capture_id,
                        ingestion_receipt_id, observed_byte_size,
                        observed_modified_time_ns, discovered_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        source_identifier,
                        original_relative_path,
                        capture_id,
                        ingestion_receipt_id,
                        observed_byte_size,
                        observed_modified_time_ns,
                        stamp,
                    ),
                )

            ingested: list[IngestedDocument] = []
            for page_index in sorted(page_indexes):
                doc_identifier = document_id(source_identifier, page_index)
                job_identifier = _job_id(doc_identifier, bundle_fingerprint)
                existing_job = connection.execute(
                    "SELECT bundle_fingerprint FROM jobs WHERE document_id=?", (doc_identifier,)
                ).fetchone()
                if existing_job is not None and existing_job[0] != bundle_fingerprint:
                    raise StorageError(
                        "document is already bound to a different pipeline bundle"
                    )
                document_inserted = connection.execute(
                    """
                    INSERT OR IGNORE INTO documents(document_id, source_id, page_index, created_at)
                    VALUES (?, ?, ?, ?)
                    """,
                    (doc_identifier, source_identifier, page_index, stamp),
                ).rowcount == 1
                connection.execute(
                    """
                    INSERT OR IGNORE INTO jobs(
                        job_id, document_id, bundle_fingerprint, state, available_at,
                        created_at, updated_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        job_identifier,
                        doc_identifier,
                        bundle_fingerprint,
                        JobState.QUEUED,
                        stamp,
                        stamp,
                        stamp,
                    ),
                )
                if document_inserted:
                    _insert_state_event(
                        connection,
                        entity_type="document",
                        entity_id=doc_identifier,
                        from_state=None,
                        to_state="created",
                        reason="source copied and page discovered",
                        created_at=stamp,
                    )
                page_preprocessing = next(
                    (
                        item
                        for item in preprocessings
                        if item.page_index == page_index
                    ),
                    None,
                )
                if page_preprocessing is not None:
                    _insert_preprocessing(
                        connection,
                        document_identifier=doc_identifier,
                        preprocessing=page_preprocessing,
                        created_at=stamp,
                    )
                ingested.append(
                    IngestedDocument(
                        source_id=source_identifier,
                        document_id=doc_identifier,
                        job_id=job_identifier,
                        duplicate=not document_inserted,
                    )
                )
                for artifact in artifacts:
                    if artifact.page_index != page_index:
                        continue
                    _insert_ingestion_artifact(
                        connection,
                        job_id=job_identifier,
                        artifact=artifact,
                        created_at=stamp,
                    )
            return tuple(ingested)

    def has_source_discovery(
        self,
        original_relative_path: str,
        observed_byte_size: int,
        observed_modified_time_ns: int,
    ) -> bool:
        _validate_relative_path(original_relative_path)
        if observed_byte_size < 0 or observed_modified_time_ns < 0:
            raise StorageError("source observation values must not be negative")
        with self._connection() as connection:
            return (
                connection.execute(
                    """
                    SELECT 1 FROM source_discoveries
                    WHERE original_relative_path=? AND observed_byte_size=?
                        AND observed_modified_time_ns=?
                    LIMIT 1
                    """,
                    (
                        original_relative_path,
                        observed_byte_size,
                        observed_modified_time_ns,
                    ),
                ).fetchone()
                is not None
            )

    def record_ingestion_rejection(
        self,
        *,
        rejection_id: str,
        original_relative_path: str,
        reason_code: str,
        detail: str,
        byte_size: int | None = None,
        modified_time_ns: int | None = None,
        local_path: str | None = None,
    ) -> IngestionRejection:
        _validate_relative_path(original_relative_path)
        if local_path is not None:
            _validate_relative_path(local_path)
        if byte_size is not None and byte_size < 0:
            raise StorageError("rejection byte_size must not be negative")
        if not reason_code or not detail:
            raise StorageError("rejection reason_code and detail are required")
        with self._connection() as connection:
            connection.execute(
                """
                INSERT OR IGNORE INTO ingestion_rejections(
                    rejection_id, original_relative_path, reason_code, detail,
                    byte_size, modified_time_ns, local_path, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    rejection_id,
                    original_relative_path,
                    reason_code,
                    detail,
                    byte_size,
                    modified_time_ns,
                    local_path,
                    _timestamp(self._clock()),
                ),
            )
        return IngestionRejection(rejection_id, reason_code, detail)

    def has_ingestion_rejection(
        self, original_relative_path: str, byte_size: int, modified_time_ns: int
    ) -> bool:
        _validate_relative_path(original_relative_path)
        with self._connection() as connection:
            row = connection.execute(
                """
                SELECT 1 FROM ingestion_rejections
                WHERE original_relative_path=? AND byte_size=? AND modified_time_ns=?
                LIMIT 1
                """,
                (original_relative_path, byte_size, modified_time_ns),
            ).fetchone()
            return row is not None

    def claim_job(
        self,
        *,
        worker_id: str,
        lease_seconds: int,
        max_attempts: int | None = None,
    ) -> ClaimedJob | None:
        if not worker_id or not worker_id.strip():
            raise StorageError("worker_id must not be empty")
        if lease_seconds < 1:
            raise StorageError("lease_seconds must be positive")
        if max_attempts is not None and max_attempts < 1:
            raise StorageError("max_attempts must be positive")
        with self._connection() as connection:
            connection.execute("BEGIN IMMEDIATE")
            moment = self._clock()
            stamp = _timestamp(moment)
            expires = moment + timedelta(seconds=lease_seconds)
            if max_attempts is not None:
                _mark_exhausted_jobs(connection, stamp, max_attempts)
                eligible = "state='queued' OR (state='failed_retryable' AND attempt_count < ?)"
            else:
                eligible = "state IN ('queued', 'failed_retryable')"
            row = connection.execute(
                f"""
                SELECT job_id, document_id, bundle_fingerprint, attempt_count, lease_epoch, state
                FROM jobs
                WHERE ({eligible}) AND available_at <= ?
                ORDER BY created_at, job_id
                LIMIT 1
                """,
                (max_attempts, stamp) if max_attempts is not None else (stamp,),
            ).fetchone()
            if row is None:
                return None
            new_epoch = int(row[4]) + 1
            updated = connection.execute(
                f"""
                UPDATE jobs
                SET state='processing', attempt_count=attempt_count+1,
                    lease_owner=?, lease_epoch=?, lease_expires_at=?, updated_at=?
                WHERE job_id=? AND ({eligible})
                """,
                (worker_id, new_epoch, _timestamp(expires), stamp, row[0], max_attempts)
                if max_attempts is not None
                else (worker_id, new_epoch, _timestamp(expires), stamp, row[0]),
            ).rowcount
            if updated != 1:
                raise StorageError("job claim lost a concurrent update")
            _insert_state_event(
                connection,
                entity_type="job",
                entity_id=row[0],
                from_state=row[5],
                to_state="processing",
                reason="worker lease claimed",
                lease_owner=worker_id,
                lease_epoch=new_epoch,
                created_at=stamp,
            )
            return ClaimedJob(
                job_id=row[0],
                document_id=row[1],
                bundle_fingerprint=row[2],
                attempt_count=int(row[3]) + 1,
                lease_owner=worker_id,
                lease_epoch=new_epoch,
                lease_expires_at=expires,
            )

    def renew_lease(
        self,
        *,
        job_id: str,
        worker_id: str,
        lease_epoch: int,
        lease_seconds: int,
    ) -> datetime:
        with self._connection() as connection:
            connection.execute("BEGIN IMMEDIATE")
            moment = self._clock()
            expires = moment + timedelta(seconds=lease_seconds)
            updated = connection.execute(
                """
                UPDATE jobs SET lease_expires_at=?, updated_at=?
                WHERE job_id=? AND state='processing' AND lease_owner=?
                  AND lease_epoch=? AND lease_expires_at > ?
                """,
                (
                    _timestamp(expires),
                    _timestamp(moment),
                    job_id,
                    worker_id,
                    lease_epoch,
                    _timestamp(moment),
                ),
            ).rowcount
            if updated != 1:
                raise LeaseLostError(f"lease lost for job {job_id}")
        return expires

    def recover_expired_leases(self, *, max_attempts: int | None = None) -> int:
        if max_attempts is not None and max_attempts < 1:
            raise StorageError("max_attempts must be positive")
        recovered = 0
        with self._connection() as connection:
            connection.execute("BEGIN IMMEDIATE")
            moment = self._clock()
            stamp = _timestamp(moment)
            rows = connection.execute(
                """
                SELECT job_id, lease_owner, lease_epoch, attempt_count
                FROM jobs
                WHERE state='processing' AND lease_expires_at <= ?
                ORDER BY lease_expires_at
                """,
                (stamp,),
            ).fetchall()
            for row in rows:
                exhausted = max_attempts is not None and int(row[3]) >= max_attempts
                next_state = "failed_permanent" if exhausted else "failed_retryable"
                reason = "max_job_attempts_exceeded" if exhausted else "worker lease expired"
                updated = connection.execute(
                    """
                    UPDATE jobs
                    SET state=?, available_at=?, lease_owner=NULL,
                        lease_expires_at=NULL, last_error=?, updated_at=?
                    WHERE job_id=? AND state='processing' AND lease_epoch=?
                    """,
                    (next_state, stamp, reason, stamp, row[0], row[2]),
                ).rowcount
                if updated == 1:
                    recovered += 1
                    _insert_state_event(
                        connection,
                        entity_type="job",
                        entity_id=row[0],
                        from_state="processing",
                        to_state=next_state,
                        reason=reason,
                        lease_owner=row[1],
                        lease_epoch=row[2],
                        created_at=stamp,
                    )
        return recovered

    def fail_job(
        self,
        *,
        job_id: str,
        worker_id: str,
        lease_epoch: int,
        error_code: str,
        retryable: bool,
        retry_delay_seconds: float = 0,
        max_attempts: int | None = None,
    ) -> None:
        if not error_code or any(character.isspace() for character in error_code):
            raise StorageError("job error_code must be a stable identifier")
        if retry_delay_seconds < 0:
            raise StorageError("job retry delay must not be negative")
        if max_attempts is not None and max_attempts < 1:
            raise StorageError("max_attempts must be positive")
        with self._connection() as connection:
            connection.execute("BEGIN IMMEDIATE")
            moment = self._clock()
            stamp = _timestamp(moment)
            _assert_owned_job(connection, job_id, worker_id, lease_epoch, stamp)
            attempt_row = connection.execute(
                "SELECT attempt_count FROM jobs WHERE job_id=?", (job_id,)
            ).fetchone()
            attempt_count = int(attempt_row[0]) if attempt_row is not None else 0
            exhausted = max_attempts is not None and attempt_count >= max_attempts
            state = (
                JobState.FAILED_RETRYABLE
                if retryable and not exhausted
                else JobState.FAILED_PERMANENT
            )
            if exhausted:
                error_code = "max_job_attempts_exceeded"
            available_at = moment + timedelta(seconds=retry_delay_seconds)
            updated = connection.execute(
                """
                UPDATE jobs
                SET state=?, available_at=?, lease_owner=NULL, lease_expires_at=NULL,
                    last_error=?, updated_at=?
                WHERE job_id=? AND state='processing' AND lease_owner=? AND lease_epoch=?
                """,
                (
                    state,
                    _timestamp(available_at),
                    error_code,
                    stamp,
                    job_id,
                    worker_id,
                    lease_epoch,
                ),
            ).rowcount
            if updated != 1:
                raise LeaseLostError(f"lease lost for job {job_id}")
            _insert_state_event(
                connection,
                entity_type="job",
                entity_id=job_id,
                from_state="processing",
                to_state=state,
                reason=error_code,
                lease_owner=worker_id,
                lease_epoch=lease_epoch,
                created_at=stamp,
            )

    def processing_context(self, job_id: str) -> ProcessingContext:
        with self._connection() as connection:
            row = connection.execute(
                """
                SELECT jobs.job_id, jobs.document_id, jobs.bundle_fingerprint,
                       source_files.source_id, source_files.sha256, source_files.byte_size,
                       source_files.local_path, source_files.media_type,
                       source_files.service_date,
                       discoveries.capture_id, documents.page_index,
                       document_preprocessing.disposition,
                       document_preprocessing.reason_code
                FROM jobs
                JOIN documents ON documents.document_id=jobs.document_id
                JOIN source_files ON source_files.source_id=documents.source_id
                LEFT JOIN source_discoveries AS discoveries
                  ON discoveries.discovery_id=(
                    SELECT MAX(candidate.discovery_id)
                    FROM source_discoveries AS candidate
                    WHERE candidate.source_id=source_files.source_id
                  )
                LEFT JOIN document_preprocessing
                  ON document_preprocessing.document_id=documents.document_id
                WHERE jobs.job_id=?
                """,
                (job_id,),
            ).fetchone()
            if row is None:
                raise StorageError("processing job does not exist")
            artifact_rows = connection.execute(
                """
                SELECT artifact_id, job_id, kind, relative_path, media_type, sha256,
                       byte_size, page_index, field_name, row_index, template_version
                FROM artifacts WHERE job_id=? ORDER BY kind, field_name, artifact_id
                """,
                (job_id,),
            ).fetchall()
            artifacts = tuple(_stored_artifact(value) for value in artifact_rows)
            return ProcessingContext(
                job_id=str(row[0]),
                document_id=str(row[1]),
                bundle_fingerprint=str(row[2]),
                source_id=str(row[3]),
                source_sha256=str(row[4]),
                source_byte_size=int(row[5]),
                source_relative_path=str(row[6]),
                source_media_type=str(row[7]),
                service_date=str(row[8]) if row[8] is not None else None,
                capture_id=str(row[9]) if row[9] is not None else None,
                page_index=int(row[10]),
                preprocessing_disposition=str(row[11]) if row[11] is not None else None,
                preprocessing_reason_code=str(row[12]) if row[12] is not None else None,
                artifacts=artifacts,
            )

    def record_artifact(
        self,
        *,
        artifact_id: str,
        job_id: str,
        worker_id: str,
        lease_epoch: int,
        kind: str,
        relative_path: str,
        media_type: str,
        sha256: str,
        byte_size: int,
        pixel_width: int | None = None,
        pixel_height: int | None = None,
        page_index: int | None = None,
        field_name: str | None = None,
        row_index: int | None = None,
        template_version: str | None = None,
    ) -> None:
        _validate_relative_path(relative_path)
        if not _is_sha256(sha256):
            raise StorageError("artifact sha256 must be a lowercase SHA-256 digest")
        if byte_size < 0:
            raise StorageError("artifact byte_size must not be negative")
        if page_index is not None and page_index < 0:
            raise StorageError("artifact page_index must be zero-based")
        if row_index is not None and not 0 <= row_index < 12:
            raise StorageError("artifact row_index must be between 0 and 11")
        if (field_name is None) != (template_version is None):
            raise StorageError(
                "artifact field_name and template_version must be provided together"
            )
        if field_name is not None:
            item_match = re.fullmatch(r"items\.(\d+)\.(name|quantity)", field_name)
            simple_match = re.fullmatch(r"(ma_luu_ky|buong_giam)\.(\d+)", field_name)
            if item_match is not None:
                expected_row = int(item_match.group(1))
                if row_index != expected_row:
                    raise StorageError("artifact row_index does not match field_name")
            elif simple_match is not None:
                maximum = 6 if simple_match.group(1) == "ma_luu_ky" else 4
                if not 0 <= int(simple_match.group(2)) < maximum or row_index is not None:
                    raise StorageError("artifact field provenance is invalid")
            else:
                raise StorageError("artifact field provenance is invalid")
        self._verify_artifact_file(relative_path, sha256, byte_size)
        with self._connection() as connection:
            connection.execute("BEGIN IMMEDIATE")
            stamp = _timestamp(self._clock())
            job = _assert_owned_job(connection, job_id, worker_id, lease_epoch, stamp)
            if page_index is not None and page_index != int(job[8]):
                raise StorageError("artifact page_index does not match claimed document")
            existing = connection.execute(
                """
                SELECT job_id, kind, relative_path, media_type, sha256, byte_size,
                       pixel_width, pixel_height, page_index, field_name, row_index,
                       template_version
                FROM artifacts WHERE artifact_id=?
                """,
                (artifact_id,),
            ).fetchone()
            expected = (
                job_id,
                kind,
                relative_path,
                media_type,
                sha256,
                byte_size,
                pixel_width,
                pixel_height,
                page_index,
                field_name,
                row_index,
                template_version,
            )
            if existing is not None:
                if tuple(existing) != expected:
                    raise StorageError("artifact identity was reused with different metadata")
                return
            connection.execute(
                """
                INSERT INTO artifacts(
                    artifact_id, job_id, kind, relative_path, media_type, sha256,
                    byte_size, pixel_width, pixel_height, page_index, field_name,
                    row_index, template_version, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    artifact_id,
                    job_id,
                    kind,
                    relative_path,
                    media_type,
                    sha256,
                    byte_size,
                    pixel_width,
                    pixel_height,
                    page_index,
                    field_name,
                    row_index,
                    template_version,
                    stamp,
                ),
            )

    def complete_job(
        self,
        *,
        job_id: str,
        worker_id: str,
        lease_epoch: int,
        result: ResultSnapshot,
        callback: CallbackEvent,
    ) -> None:
        if callback.result != result:
            raise StorageError("callback snapshot does not match result snapshot")
        result_payload = result.to_json_bytes()
        callback_payload = callback.to_json_bytes()
        with self._connection() as connection:
            connection.execute("BEGIN IMMEDIATE")
            stamp = _timestamp(self._clock())
            job = _assert_owned_job(connection, job_id, worker_id, lease_epoch, stamp)
            if job[1] != result.document_id:
                raise StorageError("result document does not belong to claimed job")
            if job[6] != result.versions.bundle_fingerprint:
                raise StorageError("result bundle does not match claimed job")
            if job[7] != result.source.source_id:
                raise StorageError("result source does not belong to claimed document")
            if int(job[8]) != result.page_index:
                raise StorageError("result page index does not match claimed document")
            expected_result_id = result_id(result.document_id, result.revision)
            if result.result_id != expected_result_id:
                raise StorageError("result_id is not deterministic for the document revision")
            expected_event_id = callback_event_id(result.document_id, result.revision)
            if callback.event_id != expected_event_id:
                raise StorageError("callback event_id is not deterministic for the result revision")
            expected_idempotency_key = (
                f"order-scanner/v1/{result.document_id}/{result.revision}"
            )
            if callback.idempotency_key != expected_idempotency_key:
                raise StorageError("callback idempotency_key does not match the result revision")
            if callback.occurred_at != result.completed_at:
                raise StorageError("callback occurred_at must match result completion time")
            artifact_ids = {artifact.artifact_id for artifact in result.artifacts}
            if artifact_ids:
                placeholders = ",".join("?" for _ in artifact_ids)
                found = {
                    row[0]
                    for row in connection.execute(
                        "SELECT artifact_id FROM artifacts "
                        f"WHERE job_id=? AND artifact_id IN ({placeholders})",
                        (job_id, *artifact_ids),
                    )
                }
                if found != artifact_ids:
                    raise StorageError("result references an artifact not owned by the claimed job")
            connection.execute(
                """
                INSERT INTO results(
                    result_id, job_id, document_id, revision, outcome, payload_json, created_at
                )
                VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    result.result_id,
                    job_id,
                    result.document_id,
                    result.revision,
                    result.outcome,
                    result_payload,
                    stamp,
                ),
            )
            connection.execute(
                """
                INSERT INTO outbox(
                    event_id, job_id, result_id, idempotency_key, payload_json,
                    state, next_attempt_at, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    callback.event_id,
                    job_id,
                    result.result_id,
                    callback.idempotency_key,
                    callback_payload,
                    OutboxState.PENDING,
                    stamp,
                    stamp,
                    stamp,
                ),
            )
            updated = connection.execute(
                """
                UPDATE jobs
                SET state='completed', lease_owner=NULL, lease_expires_at=NULL,
                    last_error=NULL, updated_at=?
                WHERE job_id=? AND state='processing' AND lease_owner=? AND lease_epoch=?
                """,
                (stamp, job_id, worker_id, lease_epoch),
            ).rowcount
            if updated != 1:
                raise LeaseLostError(f"lease lost for job {job_id}")
            _insert_state_event(
                connection,
                entity_type="job",
                entity_id=job_id,
                from_state="processing",
                to_state="completed",
                reason="result and callback outbox committed",
                lease_owner=worker_id,
                lease_epoch=lease_epoch,
                created_at=stamp,
            )

    def outbox_row(self, event_id: str) -> sqlite3.Row | None:
        with self._connection() as connection:
            row = connection.execute(
                "SELECT * FROM outbox WHERE event_id=?", (event_id,)
            ).fetchone()
            return cast(sqlite3.Row | None, row)

    def claim_outbox(
        self,
        *,
        worker_id: str,
        lease_seconds: int,
    ) -> ClaimedOutbox | None:
        if not worker_id or not worker_id.strip():
            raise StorageError("outbox worker_id must not be empty")
        if lease_seconds < 1:
            raise StorageError("outbox lease_seconds must be positive")
        with self._connection() as connection:
            connection.execute("BEGIN IMMEDIATE")
            moment = self._clock()
            stamp = _timestamp(moment)
            row = connection.execute(
                """
                SELECT event_id, idempotency_key, payload_json, attempt_count,
                       lease_epoch, state
                FROM outbox
                WHERE state IN ('pending', 'retrying') AND next_attempt_at <= ?
                  AND (lease_expires_at IS NULL OR lease_expires_at <= ?)
                ORDER BY created_at, event_id
                LIMIT 1
                """,
                (stamp, stamp),
            ).fetchone()
            if row is None:
                return None
            lease_epoch = int(row[4]) + 1
            attempt_count = int(row[3]) + 1
            expires = moment + timedelta(seconds=lease_seconds)
            updated = connection.execute(
                """
                UPDATE outbox
                SET attempt_count=?, lease_owner=?, lease_epoch=?, lease_expires_at=?,
                    updated_at=?
                WHERE event_id=? AND state IN ('pending', 'retrying')
                  AND (lease_expires_at IS NULL OR lease_expires_at <= ?)
                """,
                (
                    attempt_count,
                    worker_id,
                    lease_epoch,
                    _timestamp(expires),
                    stamp,
                    row[0],
                    stamp,
                ),
            ).rowcount
            if updated != 1:
                raise StorageError("outbox claim lost a concurrent update")
            connection.execute(
                """
                INSERT INTO callback_attempts(event_id, attempt_number, started_at)
                VALUES (?, ?, ?)
                """,
                (row[0], attempt_count, stamp),
            )
            _insert_state_event(
                connection,
                entity_type="outbox",
                entity_id=str(row[0]),
                from_state=str(row[5]),
                to_state="sending",
                reason="callback delivery claimed",
                lease_owner=worker_id,
                lease_epoch=lease_epoch,
                created_at=stamp,
            )
            return ClaimedOutbox(
                event_id=str(row[0]),
                idempotency_key=str(row[1]),
                payload=bytes(row[2]),
                attempt_count=attempt_count,
                lease_owner=worker_id,
                lease_epoch=lease_epoch,
                lease_expires_at=expires,
            )

    def mark_outbox_delivered(
        self,
        *,
        event_id: str,
        worker_id: str,
        lease_epoch: int,
        status_code: int,
    ) -> None:
        self._finish_outbox_attempt(
            event_id=event_id,
            worker_id=worker_id,
            lease_epoch=lease_epoch,
            outcome=OutboxState.DELIVERED,
            status_code=status_code,
            error_code=None,
            next_attempt_at=None,
        )

    def schedule_outbox_retry(
        self,
        *,
        event_id: str,
        worker_id: str,
        lease_epoch: int,
        delay_seconds: float,
        status_code: int | None,
        error_code: str,
    ) -> None:
        if delay_seconds < 0:
            raise StorageError("callback retry delay must not be negative")
        self._finish_outbox_attempt(
            event_id=event_id,
            worker_id=worker_id,
            lease_epoch=lease_epoch,
            outcome=OutboxState.RETRYING,
            status_code=status_code,
            error_code=error_code,
            next_attempt_at=self._clock() + timedelta(seconds=delay_seconds),
        )

    def block_outbox(
        self,
        *,
        event_id: str,
        worker_id: str,
        lease_epoch: int,
        status_code: int | None,
        error_code: str,
    ) -> None:
        self._finish_outbox_attempt(
            event_id=event_id,
            worker_id=worker_id,
            lease_epoch=lease_epoch,
            outcome=OutboxState.BLOCKED,
            status_code=status_code,
            error_code=error_code,
            next_attempt_at=None,
        )

    def replay_outbox(self, event_id: str) -> None:
        with self._connection() as connection:
            connection.execute("BEGIN IMMEDIATE")
            stamp = _timestamp(self._clock())
            row = connection.execute(
                "SELECT state, lease_owner FROM outbox WHERE event_id=?", (event_id,)
            ).fetchone()
            if row is None:
                raise StorageError("outbox event does not exist")
            if row[1] is not None:
                raise StorageError("outbox event is currently leased")
            connection.execute(
                """
                UPDATE outbox
                SET state='pending', next_attempt_at=?, last_status_code=NULL,
                    last_error=NULL, replay_count=replay_count+1, updated_at=?
                WHERE event_id=?
                """,
                (stamp, stamp, event_id),
            )
            _insert_state_event(
                connection,
                entity_type="outbox",
                entity_id=event_id,
                from_state=str(row[0]),
                to_state="pending",
                reason="manual replay requested",
                created_at=stamp,
            )

    def recover_expired_outbox_leases(self) -> int:
        with self._connection() as connection:
            connection.execute("BEGIN IMMEDIATE")
            stamp = _timestamp(self._clock())
            rows = connection.execute(
                """
                SELECT event_id, state, lease_owner, lease_epoch, attempt_count
                FROM outbox
                WHERE lease_expires_at IS NOT NULL AND lease_expires_at <= ?
                  AND state IN ('pending', 'retrying')
                """,
                (stamp,),
            ).fetchall()
            for row in rows:
                connection.execute(
                    """
                    UPDATE outbox
                    SET state='retrying', next_attempt_at=?, lease_owner=NULL,
                        lease_expires_at=NULL, last_error='callback_lease_expired', updated_at=?
                    WHERE event_id=? AND lease_epoch=?
                    """,
                    (stamp, stamp, row[0], row[3]),
                )
                connection.execute(
                    """
                    UPDATE callback_attempts
                    SET outcome='retrying', error_code='callback_lease_expired', completed_at=?
                    WHERE event_id=? AND attempt_number=? AND completed_at IS NULL
                    """,
                    (stamp, row[0], row[4]),
                )
                _insert_state_event(
                    connection,
                    entity_type="outbox",
                    entity_id=str(row[0]),
                    from_state="sending",
                    to_state="retrying",
                    reason="callback lease expired",
                    lease_owner=str(row[2]) if row[2] is not None else None,
                    lease_epoch=int(row[3]),
                    created_at=stamp,
                )
            return len(rows)

    def artifact(self, artifact_id: str) -> StoredArtifact | None:
        with self._connection() as connection:
            row = connection.execute(
                """
                SELECT artifact_id, job_id, kind, relative_path, media_type, sha256,
                       byte_size, page_index, field_name, row_index, template_version
                FROM artifacts WHERE artifact_id=?
                """,
                (artifact_id,),
            ).fetchone()
            return _stored_artifact(row) if row is not None else None

    def outbox_counts(self) -> dict[str, int]:
        with self._connection() as connection:
            rows = connection.execute(
                "SELECT state, COUNT(*) FROM outbox GROUP BY state"
            ).fetchall()
            return {str(row[0]): int(row[1]) for row in rows}

    def health_check(self) -> bool:
        try:
            with self._connection() as connection:
                return connection.execute("SELECT 1").fetchone() is not None
        except StorageError:
            return False

    def operational_metrics(self) -> dict[str, float]:
        """Return service-level counters plus queue age and processing latency."""
        with self._connection() as connection:
            now = _timestamp(self._clock())
            queue_age = connection.execute(
                """
                SELECT COALESCE(
                    MAX((julianday(?) - julianday(created_at)) * 86400.0), 0.0
                )
                FROM jobs WHERE state IN ('queued', 'failed_retryable')
                """,
                (now,),
            ).fetchone()[0]
            job_counts = connection.execute(
                """
                SELECT COUNT(*), SUM(state='processing'),
                       SUM(state IN ('failed_retryable', 'failed_permanent'))
                FROM jobs
                """
            ).fetchone()
            result_counts = connection.execute(
                "SELECT COUNT(*), SUM(outcome='needs_review') FROM results"
            ).fetchone()
            callback = connection.execute(
                """
                SELECT SUM(state IN ('pending', 'retrying')), SUM(lease_owner IS NOT NULL)
                FROM outbox
                """
            ).fetchone()
            latency = connection.execute(
                """
                SELECT AVG((julianday(done.created_at) - julianday(start.created_at)) * 86400.0)
                FROM state_events AS done
                JOIN state_events AS start
                  ON start.entity_type='job' AND start.entity_id=done.entity_id
                 AND start.to_state='processing'
                WHERE done.entity_type='job' AND done.to_state='completed'
                  AND start.event_sequence < done.event_sequence
                """
            ).fetchone()[0]
        total_jobs = int(job_counts[0] or 0)
        total_results = int(result_counts[0] or 0)
        return {
            "queue_age_seconds": max(0.0, float(queue_age or 0.0)),
            "stage_latency_seconds": max(0.0, float(latency or 0.0)),
            "review_rate": (float(result_counts[1] or 0) / total_results) if total_results else 0.0,
            "error_rate": (float(job_counts[2] or 0) / total_jobs) if total_jobs else 0.0,
            "worker_leases": float(job_counts[1] or 0),
            "callback_backlog": float(callback[0] or 0),
            "callback_leases": float(callback[1] or 0),
        }

    def _finish_outbox_attempt(
        self,
        *,
        event_id: str,
        worker_id: str,
        lease_epoch: int,
        outcome: OutboxState,
        status_code: int | None,
        error_code: str | None,
        next_attempt_at: datetime | None,
    ) -> None:
        if error_code is not None and (
            not error_code or any(character.isspace() for character in error_code)
        ):
            raise StorageError("callback error_code must be a stable identifier")
        with self._connection() as connection:
            connection.execute("BEGIN IMMEDIATE")
            stamp = _timestamp(self._clock())
            row = _assert_owned_outbox(
                connection, event_id, worker_id, lease_epoch, stamp
            )
            next_stamp = _timestamp(next_attempt_at) if next_attempt_at is not None else stamp
            updated = connection.execute(
                """
                UPDATE outbox
                SET state=?, next_attempt_at=?, last_status_code=?, last_error=?,
                    lease_owner=NULL, lease_expires_at=NULL, updated_at=?
                WHERE event_id=? AND lease_owner=? AND lease_epoch=?
                """,
                (
                    outcome,
                    next_stamp,
                    status_code,
                    error_code,
                    stamp,
                    event_id,
                    worker_id,
                    lease_epoch,
                ),
            ).rowcount
            if updated != 1:
                raise LeaseLostError(f"lease lost for outbox event {event_id}")
            connection.execute(
                """
                UPDATE callback_attempts
                SET outcome=?, status_code=?, error_code=?, completed_at=?
                WHERE event_id=? AND attempt_number=? AND completed_at IS NULL
                """,
                (outcome, status_code, error_code, stamp, event_id, row[4]),
            )
            _insert_state_event(
                connection,
                entity_type="outbox",
                entity_id=event_id,
                from_state="sending",
                to_state=outcome,
                reason=error_code or "callback acknowledged",
                lease_owner=worker_id,
                lease_epoch=lease_epoch,
                created_at=stamp,
            )

    def status_counts(self) -> dict[str, int]:
        with self._connection() as connection:
            rows = connection.execute("SELECT state, COUNT(*) FROM jobs GROUP BY state").fetchall()
            return {str(row[0]): int(row[1]) for row in rows}

    def state_events(self, entity_id: str) -> list[sqlite3.Row]:
        with self._connection() as connection:
            return connection.execute(
                "SELECT * FROM state_events WHERE entity_id=? ORDER BY event_sequence", (entity_id,)
            ).fetchall()

    def ingestion_rejections(self) -> list[sqlite3.Row]:
        with self._connection() as connection:
            return connection.execute(
                "SELECT * FROM ingestion_rejections ORDER BY created_at, rejection_id"
            ).fetchall()

    def record_visual_fingerprint(
        self,
        *,
        document_id: str,
        fingerprint: str,
        review_distance: int = 8,
        lookback: int = 1_000,
    ) -> tuple[VisualDuplicate, ...]:
        if not re.fullmatch(r"[0-9a-f]{16}", fingerprint):
            raise StorageError("visual fingerprint must be a 64-bit hexadecimal value")
        if review_distance < 0 or lookback < 1:
            raise StorageError("visual fingerprint limits are invalid")
        with self._connection() as connection:
            connection.execute("BEGIN IMMEDIATE")
            stamp = _timestamp(self._clock())
            if connection.execute(
                "SELECT 1 FROM documents WHERE document_id=?", (document_id,)
            ).fetchone() is None:
                raise StorageError("visual fingerprint document does not exist")
            existing = connection.execute(
                "SELECT fingerprint FROM document_fingerprints WHERE document_id=?",
                (document_id,),
            ).fetchone()
            if existing is not None and existing[0] != fingerprint:
                raise StorageError("document visual fingerprint is immutable")
            rows = connection.execute(
                """
                SELECT document_id, fingerprint FROM document_fingerprints
                WHERE document_id != ? ORDER BY created_at DESC LIMIT ?
                """,
                (document_id, lookback),
            ).fetchall()
            matches = [
                VisualDuplicate(str(row[0]), _fingerprint_distance(fingerprint, str(row[1])))
                for row in rows
            ]
            matches = [match for match in matches if match.distance <= review_distance]
            closest = min(
                matches,
                key=lambda match: (match.distance, match.document_id),
                default=None,
            )
            connection.execute(
                """
                INSERT INTO document_fingerprints(
                    document_id, fingerprint, possible_duplicate_of,
                    hamming_distance, created_at
                ) VALUES (?, ?, ?, ?, ?)
                ON CONFLICT(document_id) DO UPDATE SET
                    possible_duplicate_of=excluded.possible_duplicate_of,
                    hamming_distance=excluded.hamming_distance
                """,
                (
                    document_id,
                    fingerprint,
                    closest.document_id if closest else None,
                    closest.distance if closest else None,
                    stamp,
                ),
            )
            return tuple(sorted(matches, key=lambda match: (match.distance, match.document_id)))

    def _verify_artifact_file(
        self, relative_path: str, expected_sha256: str, expected_size: int
    ) -> None:
        if self.artifact_root is None:
            raise StorageError("artifact_root is required to persist artifact metadata")
        _validate_relative_path(relative_path)
        if self.artifact_root.is_symlink():
            raise StorageError("artifact root must not be a symlink")
        target = self.artifact_root.joinpath(*PurePosixPath(relative_path).parts)
        current = self.artifact_root
        for part in PurePosixPath(relative_path).parts[:-1]:
            current /= part
            if current.is_symlink():
                raise StorageError("artifact path contains a symlinked directory")
        if not target.is_file() or target.is_symlink():
            raise StorageError("artifact file is missing")
        digest = hashlib.sha256()
        size = 0
        try:
            with target.open("rb") as handle:
                while chunk := handle.read(1024 * 1024):
                    digest.update(chunk)
                    size += len(chunk)
        except OSError as exc:
            raise StorageError(f"cannot verify artifact file: {type(exc).__name__}") from None
        if size != expected_size or digest.hexdigest() != expected_sha256:
            raise StorageError("artifact file bytes do not match metadata")

    @contextmanager
    def _connection(self) -> Iterator[sqlite3.Connection]:
        self.database_path.parent.mkdir(parents=True, exist_ok=True)
        try:
            connection = sqlite3.connect(
                self.database_path,
                timeout=self.busy_timeout_ms / 1000,
                isolation_level=None,
            )
        except sqlite3.Error as exc:
            raise StorageError(f"cannot open database: {type(exc).__name__}") from None
        try:
            connection.row_factory = sqlite3.Row
            connection.execute("PRAGMA foreign_keys=ON")
            connection.execute(f"PRAGMA busy_timeout={self.busy_timeout_ms}")
            connection.execute("PRAGMA journal_mode=WAL")
            connection.execute("PRAGMA synchronous=FULL")
            yield connection
            if connection.in_transaction:
                connection.commit()
        except sqlite3.IntegrityError as exc:
            connection.rollback()
            raise StorageError(f"database constraint failed: {str(exc).split(':', 1)[0]}") from None
        except sqlite3.Error as exc:
            connection.rollback()
            raise StorageError(f"database operation failed: {type(exc).__name__}") from None
        finally:
            connection.close()

    @staticmethod
    def _execute_script(connection: sqlite3.Connection, script: str) -> None:
        statement = ""
        for line in script.splitlines():
            statement += line + "\n"
            if sqlite3.complete_statement(statement):
                connection.execute(statement)
                statement = ""
        if statement.strip():
            raise MigrationError("migration contains an incomplete SQL statement")


def _assert_owned_job(
    connection: sqlite3.Connection,
    job_id: str,
    worker_id: str,
    lease_epoch: int,
    now: str,
) -> sqlite3.Row:
    row = connection.execute(
        """
        SELECT
            jobs.job_id, jobs.document_id, jobs.state, jobs.lease_owner,
            jobs.lease_epoch, jobs.lease_expires_at, jobs.bundle_fingerprint,
            documents.source_id, documents.page_index
        FROM jobs
        JOIN documents ON documents.document_id = jobs.document_id
        WHERE jobs.job_id=?
        """,
        (job_id,),
    ).fetchone()
    if (
        row is None
        or row[2] != JobState.PROCESSING
        or row[3] != worker_id
        or int(row[4]) != lease_epoch
        or row[5] is None
        or row[5] <= now
    ):
        raise LeaseLostError(f"lease lost for job {job_id}")
    return cast(sqlite3.Row, row)


def _mark_exhausted_jobs(
    connection: sqlite3.Connection, stamp: str, max_attempts: int
) -> None:
    rows = connection.execute(
        """
        SELECT job_id, lease_owner, lease_epoch
        FROM jobs
        WHERE state='failed_retryable' AND attempt_count >= ?
        """,
        (max_attempts,),
    ).fetchall()
    for row in rows:
        updated = connection.execute(
            """
            UPDATE jobs
            SET state='failed_permanent', available_at=?, lease_owner=NULL,
                lease_expires_at=NULL, last_error='max_job_attempts_exceeded', updated_at=?
            WHERE job_id=? AND state='failed_retryable' AND attempt_count >= ?
            """,
            (stamp, stamp, row[0], max_attempts),
        ).rowcount
        if updated == 1:
            _insert_state_event(
                connection,
                entity_type="job",
                entity_id=row[0],
                from_state="failed_retryable",
                to_state="failed_permanent",
                reason="max_job_attempts_exceeded",
                lease_owner=row[1],
                lease_epoch=row[2],
                created_at=stamp,
            )


def _assert_owned_outbox(
    connection: sqlite3.Connection,
    event_id: str,
    worker_id: str,
    lease_epoch: int,
    now: str,
) -> sqlite3.Row:
    row = connection.execute(
        """
        SELECT event_id, state, lease_owner, lease_epoch, attempt_count, lease_expires_at
        FROM outbox WHERE event_id=?
        """,
        (event_id,),
    ).fetchone()
    if (
        row is None
        or row[1] not in (OutboxState.PENDING, OutboxState.RETRYING)
        or row[2] != worker_id
        or int(row[3]) != lease_epoch
        or row[5] is None
        or row[5] <= now
    ):
        raise LeaseLostError(f"lease lost for outbox event {event_id}")
    return cast(sqlite3.Row, row)


def _stored_artifact(row: sqlite3.Row) -> StoredArtifact:
    return StoredArtifact(
        artifact_id=str(row[0]),
        job_id=str(row[1]),
        kind=str(row[2]),
        relative_path=str(row[3]),
        media_type=str(row[4]),
        sha256=str(row[5]),
        byte_size=int(row[6]),
        page_index=int(row[7]) if row[7] is not None else None,
        field_name=str(row[8]) if row[8] is not None else None,
        row_index=int(row[9]) if row[9] is not None else None,
        template_version=str(row[10]) if row[10] is not None else None,
    )


def _insert_state_event(
    connection: sqlite3.Connection,
    *,
    entity_type: str,
    entity_id: str,
    from_state: str | None,
    to_state: str,
    reason: str,
    created_at: str,
    lease_owner: str | None = None,
    lease_epoch: int | None = None,
) -> None:
    connection.execute(
        """
        INSERT INTO state_events(
            entity_type, entity_id, from_state, to_state, reason,
            lease_owner, lease_epoch, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            entity_type,
            entity_id,
            from_state,
            to_state,
            reason,
            lease_owner,
            lease_epoch,
            created_at,
        ),
    )


def _validate_ingestion_artifact(
    artifact: IngestionArtifact, page_indexes: set[int]
) -> None:
    _validate_relative_path(artifact.relative_path)
    if not _is_sha256(artifact.sha256):
        raise StorageError("artifact sha256 must be a lowercase SHA-256 digest")
    if artifact.byte_size < 0:
        raise StorageError("artifact byte_size must not be negative")
    if artifact.pixel_width < 1 or artifact.pixel_height < 1:
        raise StorageError("artifact pixel dimensions must be positive")
    if artifact.page_index not in page_indexes:
        raise StorageError("artifact page_index does not belong to the source pages")
    if not artifact.template_version:
        raise StorageError("artifact template_version is required")
    item_match = re.fullmatch(r"items\.(\d+)\.(name|quantity)", artifact.field_name)
    simple_match = re.fullmatch(r"(ma_luu_ky|buong_giam)\.(\d+)", artifact.field_name)
    if item_match is not None:
        if artifact.row_index != int(item_match.group(1)):
            raise StorageError("artifact row_index does not match field_name")
    elif simple_match is not None:
        maximum = 6 if simple_match.group(1) == "ma_luu_ky" else 4
        if not 0 <= int(simple_match.group(2)) < maximum or artifact.row_index is not None:
            raise StorageError("artifact field provenance is invalid")
    else:
        raise StorageError("artifact field provenance is invalid")


def _insert_ingestion_artifact(
    connection: sqlite3.Connection,
    *,
    job_id: str,
    artifact: IngestionArtifact,
    created_at: str,
) -> None:
    values = (
        job_id,
        artifact.kind,
        artifact.relative_path,
        artifact.media_type,
        artifact.sha256,
        artifact.byte_size,
        artifact.pixel_width,
        artifact.pixel_height,
        artifact.page_index,
        artifact.field_name,
        artifact.row_index,
        artifact.template_version,
    )
    existing = connection.execute(
        """
        SELECT job_id, kind, relative_path, media_type, sha256, byte_size,
            pixel_width, pixel_height, page_index, field_name, row_index,
            template_version
        FROM artifacts WHERE artifact_id=?
        """,
        (artifact.artifact_id,),
    ).fetchone()
    if existing is not None:
        if tuple(existing) != values:
            raise StorageError("artifact identity was reused with different provenance")
        return
    connection.execute(
        """
        INSERT INTO artifacts(
            artifact_id, job_id, kind, relative_path, media_type, sha256,
            byte_size, pixel_width, pixel_height, page_index, field_name,
            row_index, template_version, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (artifact.artifact_id, *values, created_at),
    )


def _validate_preprocessing(
    preprocessing: PreprocessingDisposition, page_indexes: set[int]
) -> None:
    if preprocessing.page_index not in page_indexes:
        raise StorageError("preprocessing page_index does not belong to the source pages")
    if preprocessing.disposition not in {"aligned", "needs_review"}:
        raise StorageError("preprocessing disposition is invalid")
    if (preprocessing.disposition == "aligned") != (preprocessing.reason_code is None):
        raise StorageError("preprocessing disposition and reason_code are inconsistent")
    if not preprocessing.template_version:
        raise StorageError("preprocessing template_version is required")
    if any(not math.isfinite(value) for point in preprocessing.source_markers for value in point):
        raise StorageError("preprocessing marker coordinates must be finite")
    for value in (preprocessing.marker_size_cv, preprocessing.reprojection_error_px):
        if value is not None and (not math.isfinite(value) or value < 0):
            raise StorageError("preprocessing metrics must be finite and non-negative")


def _insert_preprocessing(
    connection: sqlite3.Connection,
    *,
    document_identifier: str,
    preprocessing: PreprocessingDisposition,
    created_at: str,
) -> None:
    markers_json = json.dumps(
        preprocessing.source_markers,
        separators=(",", ":"),
    ).encode("utf-8")
    values = (
        preprocessing.disposition,
        preprocessing.reason_code,
        markers_json,
        preprocessing.marker_size_cv,
        preprocessing.reprojection_error_px,
        preprocessing.template_version,
    )
    existing = connection.execute(
        """
        SELECT disposition, reason_code, source_markers_json, marker_size_cv,
            reprojection_error_px, template_version
        FROM document_preprocessing WHERE document_id=?
        """,
        (document_identifier,),
    ).fetchone()
    if existing is not None:
        if tuple(existing) != values:
            raise StorageError("document preprocessing was reused with different evidence")
        return
    connection.execute(
        """
        INSERT INTO document_preprocessing(
            document_id, disposition, reason_code, source_markers_json,
            marker_size_cv, reprojection_error_px, template_version, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (document_identifier, *values, created_at),
    )


def _timestamp(value: datetime) -> str:
    if value.tzinfo is None or value.utcoffset() != UTC.utcoffset(value):
        raise StorageError("timestamps must be timezone-aware UTC")
    return value.astimezone(UTC).isoformat(timespec="microseconds").replace("+00:00", "Z")


def _job_id(document_identifier: str, bundle_fingerprint: str) -> str:
    return "job_" + hashlib.sha256(
        f"{document_identifier}\x1f{bundle_fingerprint}".encode()
    ).hexdigest()


def _is_sha256(value: str) -> bool:
    return bool(re.fullmatch(r"[0-9a-f]{64}", value))


def _validate_service_date(value: str) -> None:
    try:
        parsed = date.fromisoformat(value)
    except ValueError:
        raise StorageError("service_date must use YYYY-MM-DD") from None
    if parsed.isoformat() != value:
        raise StorageError("service_date must use YYYY-MM-DD")


def _fingerprint_distance(left: str, right: str) -> int:
    return (int(left, 16) ^ int(right, 16)).bit_count()


def _validate_relative_path(value: str) -> None:
    posix_path = PurePosixPath(value)
    windows_path = PureWindowsPath(value)
    if (
        not value
        or "\\" in value
        or posix_path.is_absolute()
        or windows_path.is_absolute()
        or windows_path.drive
        or ".." in posix_path.parts
        or ".." in windows_path.parts
    ):
        raise StorageError("provenance path must be relative and traversal-free")
