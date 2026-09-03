"""Recoverable page processing from ingestion artifacts to immutable callbacks."""

from __future__ import annotations

import hashlib
import logging
import threading
from collections.abc import Callable
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path, PurePosixPath
from typing import Protocol

import numpy as np
from PIL import Image

from order_scanner.artifacts import ArtifactStoreError, ImmutableFileStore
from order_scanner.contracts import (
    ArtifactReference,
    CallbackEvent,
    FieldResult,
    FieldWarning,
    PipelineVersions,
    ResultSnapshot,
    SourceReference,
    WarningSeverity,
    result_id,
)
from order_scanner.recognition import RecognitionBackendError, RecognitionEngine
from order_scanner.storage import (
    ClaimedJob,
    LeaseLostError,
    ProcessingContext,
    Storage,
    StorageError,
    StoredArtifact,
)
from order_scanner.validation import (
    BlankDisposition,
    RowEvidence,
    unavailable_field,
    validate_page,
)

LOGGER = logging.getLogger(__name__)
GrayCrop = np.ndarray[tuple[int, int], np.dtype[np.uint8]]
BlankClassifier = Callable[[int, GrayCrop, GrayCrop], BlankDisposition]


class StopSignal(Protocol):
    def is_set(self) -> bool: ...

    def wait(self, timeout: float | None = None) -> bool: ...

    def set(self) -> None: ...


class PipelineRetryableError(RuntimeError):
    """A processing failure that should return the job to the bounded retry queue."""


class PipelinePermanentError(RuntimeError):
    """A processing failure that cannot succeed without changing the input or bundle."""


@dataclass(frozen=True, slots=True)
class ProcessedPage:
    result: ResultSnapshot
    callback: CallbackEvent


class PageProcessor:
    def __init__(
        self,
        *,
        storage: Storage,
        artifact_store: ImmutableFileStore,
        source_root: str | Path,
        versions: PipelineVersions,
        artifact_base_url: str,
        payload_max_bytes: int,
        recognition: RecognitionEngine | None = None,
        blank_classifier: BlankClassifier | None = None,
        clock: Callable[[], datetime] = lambda: datetime.now(UTC),
    ) -> None:
        if not artifact_base_url.startswith("https://"):
            raise ValueError("artifact_base_url must use HTTPS")
        if payload_max_bytes < 1:
            raise ValueError("payload_max_bytes must be positive")
        self.storage = storage
        self.artifact_store = artifact_store
        self.source_root = Path(source_root)
        self.versions = versions
        self.artifact_base_url = artifact_base_url.rstrip("/")
        self.payload_max_bytes = payload_max_bytes
        self.recognition = recognition
        self.blank_classifier = blank_classifier
        self.clock = clock

    def process(self, job: ClaimedJob) -> ProcessedPage:
        context = self.storage.processing_context(job.job_id)
        if context.document_id != job.document_id:
            raise PipelinePermanentError("job_document_mismatch")
        if context.bundle_fingerprint != job.bundle_fingerprint:
            raise PipelinePermanentError("job_bundle_mismatch")
        if self.versions.bundle_fingerprint != job.bundle_fingerprint:
            raise PipelinePermanentError("job_bundle_mismatch")
        if context.service_date is None:
            raise PipelinePermanentError("service_date_missing")
        source_artifact = self._ensure_source_artifact(context, job)
        artifact_references = self._artifact_references(
            context, source_artifact
        )

        if context.preprocessing_disposition == "aligned":
            try:
                ma_luu_ky, buong_giam, rows, extra_warnings = self._recognize(context)
            except RecognitionBackendError as exc:
                raise PipelineRetryableError("recognition_backend_unavailable") from exc
        else:
            ma_luu_ky = unavailable_field("ma_luu_ky")
            buong_giam = unavailable_field("buong_giam")
            rows = self._unavailable_rows()
            reason = context.preprocessing_reason_code or "preprocessing_not_aligned"
            extra_warnings = (
                FieldWarning(
                    "preprocessing_needs_review",
                    "page alignment did not reach the recognition stage",
                    WarningSeverity.ERROR,
                    "pipeline",
                ),
                FieldWarning(
                    reason,
                    "source page requires review before recognition",
                    WarningSeverity.ERROR,
                    "pipeline",
                ),
            )

        validation = validate_page(ma_luu_ky, buong_giam, tuple(rows))
        warnings = extra_warnings + validation.warnings
        result = ResultSnapshot(
            result_id=result_id(context.document_id, 1),
            document_id=context.document_id,
            page_index=context.page_index,
            revision=1,
            outcome=validation.outcome,
            source=SourceReference(
                context.source_id,
                capture_id=context.capture_id,
            ),
            ma_luu_ky=ma_luu_ky,
            buong_giam=buong_giam,
            items=validation.items,
            artifacts=artifact_references,
            warnings=warnings,
            versions=self.versions,
            completed_at=self.clock(),
            service_date=context.service_date,
        )
        callback = CallbackEvent.from_result(result)
        if len(callback.to_json_bytes()) > self.payload_max_bytes:
            raise PipelinePermanentError("callback_payload_too_large")
        return ProcessedPage(result, callback)

    def _ensure_source_artifact(
        self, context: ProcessingContext, job: ClaimedJob
    ) -> ArtifactReference:
        source_path = _safe_path(self.source_root, context.source_relative_path)
        relative_path = f"sources/{context.source_sha256[:2]}/{context.source_sha256}.bin"
        try:
            stored = self.artifact_store.copy_from_path(
                source_path=source_path,
                relative_path=relative_path,
                expected_sha256=context.source_sha256,
                expected_size=context.source_byte_size,
            )
            artifact_id = "art_" + hashlib.sha256(
                f"{context.document_id}\x1fsource".encode()
            ).hexdigest()
            self.storage.record_artifact(
                artifact_id=artifact_id,
                job_id=job.job_id,
                worker_id=job.lease_owner,
                lease_epoch=job.lease_epoch,
                kind="source",
                relative_path=stored.relative_path,
                media_type=context.source_media_type,
                sha256=stored.sha256,
                byte_size=stored.byte_size,
                page_index=context.page_index,
            )
        except (ArtifactStoreError, OSError) as exc:
            raise PipelineRetryableError("source_artifact_unavailable") from exc
        return self._artifact_reference(
            artifact_id=artifact_id,
            kind="source",
            media_type=context.source_media_type,
            sha256=stored.sha256,
            field_id=None,
            row_index=None,
        )

    def _artifact_references(
        self, context: ProcessingContext, source: ArtifactReference
    ) -> tuple[ArtifactReference, ...]:
        references = [source]
        for artifact in context.artifacts:
            if artifact.kind != "review-crop":
                continue
            try:
                self.artifact_store.verify_relative(
                    artifact.relative_path,
                    artifact.sha256,
                    artifact.byte_size,
                )
            except (ArtifactStoreError, OSError) as exc:
                raise PipelineRetryableError("review_artifact_unavailable") from exc
            field_id = artifact.field_name
            if field_id is not None:
                field_id = field_id.replace(".name", ".item")
            references.append(
                self._artifact_reference(
                    artifact_id=artifact.artifact_id,
                    kind=artifact.kind,
                    media_type=artifact.media_type,
                    sha256=artifact.sha256,
                    field_id=field_id,
                    row_index=artifact.row_index,
                )
            )
        return tuple(references)

    def _recognize(
        self, context: ProcessingContext
    ) -> tuple[FieldResult, FieldResult, list[RowEvidence], tuple[FieldWarning, ...]]:
        if self.recognition is None:
            return (
                unavailable_field("ma_luu_ky"),
                unavailable_field("buong_giam"),
                self._unavailable_rows(),
                (),
            )
        crops = {
            artifact.field_name: self._load_crop(artifact)
            for artifact in context.artifacts
            if artifact.kind == "inference-crop" and artifact.field_name is not None
        }
        ma_crops = [crops[key] for key in sorted(crops) if key.startswith("ma_luu_ky.")]
        room_crops = [crops[key] for key in sorted(crops) if key.startswith("buong_giam.")]
        ma_luu_ky = self.recognition.recognize_id(ma_crops)
        buong_giam = self.recognition.recognize_room(room_crops)
        rows: list[RowEvidence] = []
        for row_index in range(12):
            item_key = f"items.{row_index}.name"
            quantity_key = f"items.{row_index}.quantity"
            item_crop = crops.get(item_key)
            quantity_crop = crops.get(quantity_key)
            if item_crop is None or quantity_crop is None:
                blank = BlankDisposition.UNCERTAIN
                item = unavailable_field(f"items.{row_index}.item", row_index=row_index)
                quantity = unavailable_field(
                    f"items.{row_index}.quantity", row_index=row_index
                )
                catalogue_item_id = None
            else:
                blank = (
                    self.blank_classifier(row_index, item_crop, quantity_crop)
                    if self.blank_classifier is not None
                    else BlankDisposition.UNCERTAIN
                )
                if blank is BlankDisposition.BLANK:
                    item = FieldResult(f"items.{row_index}.item", None, None, None)
                    quantity = FieldResult(f"items.{row_index}.quantity", None, None, None)
                    catalogue_item_id = None
                else:
                    item_result = self.recognition.recognize_item(
                        item_crop, field_id=f"items.{row_index}.item"
                    )
                    item = item_result.field
                    quantity = self.recognition.recognize_quantity(
                        quantity_crop, field_id=f"items.{row_index}.quantity"
                    )
                    catalogue_item_id = item_result.catalogue_item_id
            rows.append(
                RowEvidence(
                    row_index=row_index,
                    blank=blank,
                    item=item,
                    quantity=quantity,
                    catalogue_item_id=catalogue_item_id,
                )
            )
        return ma_luu_ky, buong_giam, rows, ()

    def _unavailable_rows(self) -> list[RowEvidence]:
        return [
            RowEvidence(
                row_index=row_index,
                blank=BlankDisposition.UNCERTAIN,
                item=unavailable_field(f"items.{row_index}.item", row_index=row_index),
                quantity=unavailable_field(
                    f"items.{row_index}.quantity", row_index=row_index
                ),
            )
            for row_index in range(12)
        ]

    def _load_crop(self, artifact: StoredArtifact) -> GrayCrop:
        relative_path = artifact.relative_path
        expected_sha256 = artifact.sha256
        expected_size = artifact.byte_size
        path = _safe_path(self.artifact_store.root, relative_path)
        try:
            self.artifact_store.verify_relative(relative_path, expected_sha256, expected_size)
            with Image.open(path) as image:
                crop = np.asarray(image.convert("L"), dtype=np.uint8)
        except (ArtifactStoreError, OSError, ValueError) as exc:
            raise PipelineRetryableError("inference_artifact_unavailable") from exc
        if crop.ndim != 2 or crop.size == 0:
            raise PipelinePermanentError("inference_artifact_invalid")
        return crop

    def _artifact_reference(
        self,
        *,
        artifact_id: str,
        kind: str,
        media_type: str,
        sha256: str,
        field_id: str | None,
        row_index: int | None,
    ) -> ArtifactReference:
        return ArtifactReference(
            artifact_id=artifact_id,
            kind=kind,
            media_type=media_type,
            sha256=sha256,
            url=f"{self.artifact_base_url}/artifacts/{artifact_id}",
            field_id=field_id,
            row_index=row_index,
        )


def run_worker_loop(
    *,
    processor: PageProcessor,
    storage: Storage,
    worker_id: str,
    lease_seconds: int,
    poll_interval_seconds: float,
    stop_event: StopSignal,
    max_attempts: int | None = None,
) -> None:
    """Run one fenced worker until shutdown; jobs are never acknowledged before commit."""
    while not stop_event.is_set():
        try:
            job = storage.claim_job(
                worker_id=worker_id,
                lease_seconds=lease_seconds,
                max_attempts=max_attempts,
            )
        except StorageError:
            LOGGER.exception("durable job claim failed; worker will retry")
            stop_event.wait(poll_interval_seconds)
            continue
        if job is None:
            stop_event.wait(poll_interval_seconds)
            continue
        heartbeat_stop = threading.Event()
        heartbeat = threading.Thread(
            target=_heartbeat,
            args=(storage, job, lease_seconds, heartbeat_stop),
            name=f"heartbeat-{job.job_id[:12]}",
            daemon=True,
        )
        heartbeat.start()
        try:
            processed = processor.process(job)
            storage.complete_job(
                job_id=job.job_id,
                worker_id=worker_id,
                lease_epoch=job.lease_epoch,
                result=processed.result,
                callback=processed.callback,
            )
        except LeaseLostError:
            LOGGER.warning("processing lease lost; job will be recovered job=%s", job.job_id)
        except PipelinePermanentError as exc:
            _fail_owned_job(
                storage, job, worker_id, str(exc), retryable=False, max_attempts=max_attempts
            )
        except (PipelineRetryableError, ArtifactStoreError, OSError) as exc:
            _fail_owned_job(
                storage, job, worker_id, str(exc), retryable=True, max_attempts=max_attempts
            )
        except Exception:
            LOGGER.exception("unexpected processing failure; job=%s", job.job_id)
            _fail_owned_job(
                storage,
                job,
                worker_id,
                "pipeline_unexpected_error",
                retryable=True,
                max_attempts=max_attempts,
            )
        finally:
            heartbeat_stop.set()
            heartbeat.join(timeout=max(1.0, lease_seconds / 2))


def _heartbeat(
    storage: Storage, job: ClaimedJob, lease_seconds: int, stop_event: threading.Event
) -> None:
    interval = max(0.5, lease_seconds / 3)
    while not stop_event.wait(interval):
        try:
            storage.renew_lease(
                job_id=job.job_id,
                worker_id=job.lease_owner,
                lease_epoch=job.lease_epoch,
                lease_seconds=lease_seconds,
            )
        except LeaseLostError:
            return


def _fail_owned_job(
    storage: Storage,
    job: ClaimedJob,
    worker_id: str,
    error_code: str,
    *,
    retryable: bool,
    max_attempts: int | None = None,
) -> None:
    try:
        storage.fail_job(
            job_id=job.job_id,
            worker_id=worker_id,
            lease_epoch=job.lease_epoch,
            error_code=error_code if error_code else "pipeline_error",
            retryable=retryable,
            max_attempts=max_attempts,
        )
    except LeaseLostError:
        LOGGER.warning("failure could not be recorded after lease loss job=%s", job.job_id)
    except StorageError:
        LOGGER.exception("durable job failure transition failed job=%s", job.job_id)


def _safe_path(root: Path, relative_path: str) -> Path:
    try:
        relative = PurePosixPath(relative_path)
    except Exception:
        raise PipelinePermanentError("artifact_path_invalid") from None
    if relative.is_absolute() or ".." in relative.parts or not relative.parts:
        raise PipelinePermanentError("artifact_path_invalid")
    if root.exists() and (root.is_symlink() or not root.is_dir()):
        raise PipelinePermanentError("artifact_root_invalid")
    target = root.joinpath(*relative.parts)
    try:
        root_resolved = root.resolve()
        target_resolved = target.resolve()
    except OSError:
        raise PipelineRetryableError("artifact_path_unavailable") from None
    if root_resolved != target_resolved and root_resolved not in target_resolved.parents:
        raise PipelinePermanentError("artifact_path_invalid")
    return target
