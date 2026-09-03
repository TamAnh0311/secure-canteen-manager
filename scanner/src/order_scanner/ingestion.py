from __future__ import annotations

import hashlib
import json
import logging
import os
import tempfile
import uuid
from collections.abc import Callable
from dataclasses import asdict, dataclass
from datetime import UTC, datetime
from pathlib import Path

from order_scanner.artifacts import (
    ArtifactStoreError,
    CropArtifact,
    ImmutableFileStore,
    write_crop_artifacts,
)
from order_scanner.config import LimitConfig, ScannerConfig
from order_scanner.contracts import derive_service_date, document_id
from order_scanner.imaging import (
    AlignmentDisposition,
    AlignmentResult,
    DecodeError,
    DecodeLimits,
    align_page,
    decode_document,
    extract_crops,
    visual_fingerprint,
)
from order_scanner.storage import (
    IngestedDocument,
    IngestionArtifact,
    PreprocessingDisposition,
    Storage,
    StorageError,
    VisualDuplicate,
)
from order_scanner.template_v4 import TEMPLATE_VERSION as DEFAULT_TEMPLATE_VERSION

LOGGER = logging.getLogger("order_scanner.ingestion")


class IngestionError(RuntimeError):
    """A scanner source was not safe to ingest."""

    def __init__(
        self, reason_code: str, detail: str, *, local_path: str | None = None
    ) -> None:
        super().__init__(detail)
        self.reason_code = reason_code
        self.local_path = local_path


@dataclass(frozen=True, slots=True)
class FileObservation:
    size: int
    modified_time_ns: int


@dataclass(frozen=True, slots=True)
class Candidate:
    path: Path
    relative_path: str
    observation: FileObservation


@dataclass(frozen=True, slots=True)
class IngestionResult:
    source_id: str
    source_sha256: str
    local_path: str
    pages: tuple[IngestedDocument, ...]
    duplicate: bool
    alignments: tuple[AlignmentResult, ...]
    crop_artifacts: tuple[CropArtifact, ...]
    probable_duplicates: tuple[VisualDuplicate, ...]


@dataclass(frozen=True, slots=True)
class ReconcileReport:
    receipts_replayed: int
    temporary_files_removed: int
    incomplete_receipts: int
    legacy_receipts_without_service_date: int


class StabilityTracker:
    def __init__(self, policy: ScannerConfig) -> None:
        self.policy = policy
        self._observations: dict[Path, tuple[FileObservation, datetime, int]] = {}

    def observe(self, path: Path, now: datetime) -> bool:
        try:
            stat = path.stat()
        except OSError:
            self._observations.pop(path, None)
            return False
        observation = FileObservation(stat.st_size, stat.st_mtime_ns)
        previous = self._observations.get(path)
        if previous is None or previous[0] != observation:
            self._observations[path] = (observation, now, 1)
            return False
        first_seen = previous[1]
        count = previous[2] + 1
        self._observations[path] = (observation, first_seen, count)
        age_seconds = max(0.0, now.timestamp() - stat.st_mtime)
        stable_seconds = max(0.0, (now - first_seen).total_seconds())
        return (
            count >= self.policy.stable_observations
            and age_seconds >= self.policy.minimum_age_seconds
            and stable_seconds >= self.policy.stable_seconds
        )

    def forget(self, path: Path) -> None:
        self._observations.pop(path, None)


class ScannerInbox:
    def __init__(self, root: str | Path, policy: ScannerConfig) -> None:
        self.root = Path(root)
        self.policy = policy

    def candidates(self) -> tuple[Candidate, ...]:
        if not self.root.is_dir():
            return ()
        found: list[Candidate] = []
        try:
            paths = sorted(self.root.iterdir(), key=lambda item: item.name.casefold())
        except OSError:
            return ()
        for path in paths:
            if not path.is_file() or path.is_symlink() or self._ignored(path):
                continue
            suffix = path.suffix.lower()
            if suffix not in {item.lower() for item in self.policy.allowed_extensions}:
                continue
            try:
                stat = path.stat()
            except OSError:
                continue
            found.append(
                Candidate(
                    path,
                    path.relative_to(self.root).as_posix(),
                    FileObservation(stat.st_size, stat.st_mtime_ns),
                )
            )
        return tuple(found)

    def is_ready(self, path: Path) -> bool:
        suffix = self.policy.ready_suffix
        return suffix is None or Path(f"{path}{suffix}").is_file()

    def _ignored(self, path: Path) -> bool:
        name = path.name.casefold()
        return any(name.endswith(suffix.casefold()) for suffix in self.policy.staging_suffixes)


class IngestionService:
    def __init__(
        self,
        *,
        inbox: ScannerInbox,
        source_store: ImmutableFileStore,
        artifact_store: ImmutableFileStore,
        storage: Storage,
        limits: LimitConfig,
        scanner: ScannerConfig,
        bundle_fingerprint: str,
        clock: Callable[[], datetime] = lambda: datetime.now(UTC),
    ) -> None:
        self.inbox = inbox
        self.source_store = source_store
        self.artifact_store = artifact_store
        self.storage = storage
        self.limits = limits
        self.scanner = scanner
        self.bundle_fingerprint = bundle_fingerprint
        self.clock = clock
        self.stability = StabilityTracker(scanner)

    def poll_once(self) -> tuple[IngestionResult, ...]:
        results: list[IngestionResult] = []
        now = self.clock()
        for candidate in self.inbox.candidates():
            if not self.inbox.is_ready(candidate.path):
                continue
            if self.storage.has_ingestion_rejection(
                candidate.relative_path,
                candidate.observation.size,
                candidate.observation.modified_time_ns,
            ):
                continue
            if self.storage.has_source_discovery(
                candidate.relative_path,
                candidate.observation.size,
                candidate.observation.modified_time_ns,
            ):
                continue
            if not self.stability.observe(candidate.path, now):
                continue
            try:
                result = self.ingest(candidate)
            except IngestionError as exc:
                self._reject(candidate, exc)
                LOGGER.warning(
                    "ingestion rejected; path=%s reason=%s detail=%s",
                    candidate.relative_path,
                    exc.reason_code,
                    exc,
                )
                self.stability.forget(candidate.path)
                continue
            results.append(result)
            self.stability.forget(candidate.path)
        return tuple(results)

    def ingest(self, candidate: Candidate) -> IngestionResult:
        service_date = derive_service_date(
            self.clock(),
            self.scanner.service_date_timezone,
            self.scanner.service_date_offset_days,
        )
        path = candidate.path
        if path.is_symlink() or not path.is_file():
            raise IngestionError("source_unreadable", "scanner source is not a regular file")
        if candidate.observation.size <= 0:
            raise IngestionError("empty_source", "scanner source is empty")
        if candidate.observation.size > self.limits.max_source_bytes:
            raise IngestionError("source_size_limit_exceeded", "scanner source exceeds byte limit")
        staging_path = self.source_store.new_staging_path()
        digest, byte_size = self._copy_and_hash(path, staging_path)
        try:
            after = path.stat()
        except OSError:
            staging_path.unlink(missing_ok=True)
            raise IngestionError(
                "source_unreadable", "scanner source disappeared after copy"
            ) from None
        if (
            after.st_size != candidate.observation.size
            or after.st_mtime_ns != candidate.observation.modified_time_ns
        ):
            staging_path.unlink(missing_ok=True)
            raise IngestionError(
                "source_changed_during_copy",
                "scanner source changed while the local copy was being made",
            )

        source_relative = f"sources/{digest[:2]}/{digest}.bin"
        receipt_id = f"ing_{uuid.uuid4().hex}"
        with tempfile.TemporaryDirectory(
            prefix="decode-", dir=str(self.source_store.root)
        ) as decode_directory:
            try:
                decoded = decode_document(
                    staging_path,
                    decode_directory,
                    DecodeLimits(
                        max_pages=self.limits.max_pages,
                        max_pixels_per_page=self.limits.max_pixels_per_page,
                        timeout_seconds=self.scanner.decode_timeout_seconds,
                        memory_mb=self.scanner.decode_memory_mb,
                        pdf_dpi=self.scanner.pdf_dpi,
                    ),
                )
            except DecodeError as exc:
                quarantine_relative = f"quarantine/{digest[:2]}/{digest}.bin"
                try:
                    self.source_store.promote_staged(
                        staged_path=staging_path,
                        relative_path=quarantine_relative,
                        expected_sha256=digest,
                        expected_size=byte_size,
                    )
                except ArtifactStoreError as store_error:
                    staging_path.unlink(missing_ok=True)
                    raise IngestionError("durability_failed", str(store_error)) from None
                raise IngestionError(
                    exc.reason_code, str(exc), local_path=quarantine_relative
                ) from None

            alignments: list[AlignmentResult] = []
            crop_artifacts: list[CropArtifact] = []
            for page in decoded.pages:
                alignment = align_page(page.load())
                alignments.append(alignment)
                if alignment.disposition is AlignmentDisposition.ALIGNED:
                    if alignment.aligned is None:
                        raise IngestionError(
                            "alignment_failed", "aligned disposition returned no raster"
                        )
                    if alignment.template_version is None:
                        raise IngestionError(
                            "alignment_failed",
                            "aligned disposition returned no template version",
                        )
                    crops = extract_crops(
                        alignment.aligned, alignment.template_version
                    )
                    crop_artifacts.extend(
                        write_crop_artifacts(
                            self.artifact_store,
                            document_id=document_id(f"src_{digest}", page.page_index),
                            page_index=page.page_index,
                            template_version=alignment.template_version,
                            crops=crops,
                        )
                    )

        storage_artifacts = tuple(
            IngestionArtifact(
                artifact_id=artifact.artifact_id,
                kind=artifact.kind,
                relative_path=artifact.relative_path,
                media_type="image/png",
                sha256=artifact.sha256,
                byte_size=artifact.byte_size,
                pixel_width=artifact.pixel_width,
                pixel_height=artifact.pixel_height,
                page_index=artifact.page_index,
                field_name=artifact.field_name,
                row_index=artifact.row_index,
                template_version=artifact.template_version,
            )
            for artifact in crop_artifacts
        )
        preprocessings = tuple(
            PreprocessingDisposition(
                page_index=page.page_index,
                disposition=alignment.disposition.value,
                reason_code=alignment.reason_code,
                source_markers=alignment.source_markers,
                marker_size_cv=alignment.marker_size_cv,
                reprojection_error_px=alignment.reprojection_error_px,
                template_version=alignment.template_version
                or DEFAULT_TEMPLATE_VERSION,
            )
            for page, alignment in zip(decoded.pages, alignments, strict=True)
        )
        receipt_relative = f"receipts/{receipt_id[:2]}/{receipt_id}.json"
        receipt = {
            "receipt_id": receipt_id,
            "source_sha256": digest,
            "byte_size": byte_size,
            "source_media_type": decoded.media_type,
            "source_relative_path": source_relative,
            "original_relative_path": candidate.relative_path,
            "observed_byte_size": candidate.observation.size,
            "observed_modified_time_ns": candidate.observation.modified_time_ns,
            "page_indexes": [page.page_index for page in decoded.pages],
            "bundle_fingerprint": self.bundle_fingerprint,
            "service_date": service_date,
            "artifacts": [asdict(artifact) for artifact in storage_artifacts],
            "preprocessings": [asdict(preprocessing) for preprocessing in preprocessings],
        }
        try:
            self.source_store.put_relative_bytes(
                receipt_relative,
                json.dumps(receipt, sort_keys=True, separators=(",", ":")).encode("utf-8"),
            )
            self.source_store.promote_staged(
                staged_path=staging_path,
                relative_path=source_relative,
                expected_sha256=digest,
                expected_size=byte_size,
            )
            pages = self.storage.create_source_documents_jobs(
                source_identifier=f"src_{digest}",
                source_sha256=digest,
                byte_size=byte_size,
                local_path=source_relative,
                original_relative_path=candidate.relative_path,
                page_indexes=tuple(page.page_index for page in decoded.pages),
                bundle_fingerprint=self.bundle_fingerprint,
                source_media_type=decoded.media_type,
                service_date=service_date,
                ingestion_receipt_id=receipt_id,
                observed_byte_size=candidate.observation.size,
                observed_modified_time_ns=candidate.observation.modified_time_ns,
                artifacts=storage_artifacts,
                preprocessings=preprocessings,
            )
        except (ArtifactStoreError, StorageError) as exc:
            staging_path.unlink(missing_ok=True)
            raise IngestionError("durability_failed", str(exc)) from None
        probable_duplicates: list[VisualDuplicate] = []
        for _page, alignment, document in zip(decoded.pages, alignments, pages, strict=True):
            if alignment.aligned is None:
                continue
            try:
                probable_duplicates.extend(
                    self.storage.record_visual_fingerprint(
                        document_id=document.document_id,
                        fingerprint=visual_fingerprint(alignment.aligned),
                    )
                )
            except StorageError:
                # Fingerprints are advisory and must not block durable ingestion.
                continue
        return IngestionResult(
            source_id=f"src_{digest}",
            source_sha256=digest,
            local_path=source_relative,
            pages=pages,
            duplicate=all(page.duplicate for page in pages),
            alignments=tuple(alignments),
            crop_artifacts=tuple(crop_artifacts),
            probable_duplicates=tuple(probable_duplicates),
        )

    def reconcile_startup(self) -> ReconcileReport:
        replayed = 0
        incomplete = 0
        legacy_without_service_date = 0
        receipts_root = self.source_store.root / "receipts"
        if receipts_root.is_dir():
            for receipt_path in sorted(receipts_root.rglob("*.json")):
                try:
                    receipt = json.loads(receipt_path.read_text(encoding="utf-8"))
                    source_relative = str(receipt["source_relative_path"])
                    source_sha256 = str(receipt["source_sha256"])
                    byte_size = int(receipt["byte_size"])
                    source_media_type = str(
                        receipt.get("source_media_type", "application/octet-stream")
                    )
                    if "service_date" not in receipt:
                        legacy_without_service_date += 1
                        continue
                    service_date = str(receipt["service_date"])
                    self.source_store.verify_relative(
                        source_relative, source_sha256, byte_size
                    )
                    page_indexes = tuple(int(value) for value in receipt["page_indexes"])
                    if (
                        not page_indexes
                        or len(page_indexes) > self.limits.max_pages
                        or page_indexes != tuple(range(len(page_indexes)))
                    ):
                        raise ValueError("receipt page indexes are invalid")
                    raw_artifacts = receipt.get("artifacts", [])
                    if not isinstance(raw_artifacts, list):
                        raise ValueError("receipt artifacts are invalid")
                    artifacts = tuple(
                        IngestionArtifact(
                            artifact_id=str(item["artifact_id"]),
                            kind=str(item["kind"]),
                            relative_path=str(item["relative_path"]),
                            media_type=str(item["media_type"]),
                            sha256=str(item["sha256"]),
                            byte_size=int(item["byte_size"]),
                            pixel_width=int(item["pixel_width"]),
                            pixel_height=int(item["pixel_height"]),
                            page_index=int(item["page_index"]),
                            field_name=str(item["field_name"]),
                            row_index=(
                                int(item["row_index"])
                                if item.get("row_index") is not None
                                else None
                            ),
                            template_version=str(item["template_version"]),
                        )
                        for item in raw_artifacts
                    )
                    for artifact in artifacts:
                        self.artifact_store.verify_relative(
                            artifact.relative_path,
                            artifact.sha256,
                            artifact.byte_size,
                        )
                    raw_preprocessings = receipt.get("preprocessings", [])
                    if not isinstance(raw_preprocessings, list):
                        raise ValueError("receipt preprocessings are invalid")
                    preprocessings = tuple(
                        PreprocessingDisposition(
                            page_index=int(item["page_index"]),
                            disposition=str(item["disposition"]),
                            reason_code=(
                                str(item["reason_code"])
                                if item.get("reason_code") is not None
                                else None
                            ),
                            source_markers=tuple(
                                (float(point[0]), float(point[1]))
                                for point in item["source_markers"]
                            ),
                            marker_size_cv=(
                                float(item["marker_size_cv"])
                                if item.get("marker_size_cv") is not None
                                else None
                            ),
                            reprojection_error_px=(
                                float(item["reprojection_error_px"])
                                if item.get("reprojection_error_px") is not None
                                else None
                            ),
                            template_version=str(item["template_version"]),
                        )
                        for item in raw_preprocessings
                    )
                    pages = self.storage.create_source_documents_jobs(
                        source_identifier=f"src_{source_sha256}",
                        source_sha256=source_sha256,
                        byte_size=byte_size,
                        local_path=source_relative,
                        original_relative_path=str(receipt["original_relative_path"]),
                        page_indexes=page_indexes,
                        bundle_fingerprint=str(receipt["bundle_fingerprint"]),
                        source_media_type=source_media_type,
                        service_date=service_date,
                        ingestion_receipt_id=str(receipt["receipt_id"]),
                        observed_byte_size=(
                            int(receipt["observed_byte_size"])
                            if "observed_byte_size" in receipt
                            else None
                        ),
                        observed_modified_time_ns=(
                            int(receipt["observed_modified_time_ns"])
                            if "observed_modified_time_ns" in receipt
                            else None
                        ),
                        artifacts=artifacts,
                        preprocessings=preprocessings,
                    )
                    if pages:
                        replayed += 1
                except (
                    ArtifactStoreError,
                    OSError,
                    KeyError,
                    TypeError,
                    ValueError,
                    StorageError,
                ):
                    incomplete += 1
        removed = self.source_store.reconcile_staging()
        removed += self.source_store.reconcile_decode_directories()
        return ReconcileReport(replayed, removed, incomplete, legacy_without_service_date)

    def _copy_and_hash(self, source: Path, destination: Path) -> tuple[str, int]:
        digest = hashlib.sha256()
        size = 0
        try:
            with source.open("rb") as source_handle, destination.open("xb") as destination_handle:
                while chunk := source_handle.read(1024 * 1024):
                    size += len(chunk)
                    if size > self.limits.max_source_bytes:
                        raise IngestionError(
                            "source_size_limit_exceeded",
                            "scanner source exceeds byte limit during copy",
                        )
                    digest.update(chunk)
                    destination_handle.write(chunk)
                destination_handle.flush()
                os.fsync(destination_handle.fileno())
        except IngestionError:
            destination.unlink(missing_ok=True)
            raise
        except OSError as exc:
            destination.unlink(missing_ok=True)
            raise IngestionError(
                "source_copy_failed",
                f"cannot copy scanner source: {type(exc).__name__}",
            ) from None
        return digest.hexdigest(), size

    def _reject(self, candidate: Candidate, error: IngestionError) -> None:
        rejection_id = "rej_" + hashlib.sha256(
            f"{candidate.relative_path}\x1f{candidate.observation.size}\x1f"
            f"{candidate.observation.modified_time_ns}\x1f{error.reason_code}".encode()
        ).hexdigest()
        try:
            self.storage.record_ingestion_rejection(
                rejection_id=rejection_id,
                original_relative_path=candidate.relative_path,
                reason_code=error.reason_code,
                detail=str(error),
                byte_size=candidate.observation.size,
                modified_time_ns=candidate.observation.modified_time_ns,
                local_path=error.local_path,
            )
        except StorageError:
            # The original error is more actionable than a secondary audit failure.
            return
