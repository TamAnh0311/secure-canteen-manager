from __future__ import annotations

import json
import logging
import sqlite3
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

import cv2 as _cv2
import numpy as np
import pytest
from PIL import Image

from order_scanner.artifacts import ImmutableFileStore
from order_scanner.config import LimitConfig, ScannerConfig
from order_scanner.imaging import AlignmentDisposition
from order_scanner.ingestion import (
    Candidate,
    FileObservation,
    IngestionError,
    IngestionService,
    ScannerInbox,
    StabilityTracker,
)
from order_scanner.storage import Storage
from order_scanner.template_skm import (
    TEMPLATE_VERSION as SKM_TEMPLATE_VERSION,
)
from order_scanner.template_skm import (
    crop_specs as skm_crop_specs,
)
from order_scanner.template_v4 import (
    CANONICAL_HEIGHT,
    CANONICAL_WIDTH,
    crop_specs,
    marker_centers,
)

cv2: Any = _cv2

BUNDLE = "b" * 64


def _service(
    tmp_path: Path,
    *,
    storage: Storage | None = None,
    scanner: ScannerConfig | None = None,
    limits: LimitConfig | None = None,
) -> IngestionService:
    inbox_path = tmp_path / "inbox"
    inbox_path.mkdir(parents=True, exist_ok=True)
    database = storage or Storage(
        tmp_path / "state.sqlite3", artifact_root=tmp_path / "artifacts"
    )
    database.migrate(Path(__file__).parents[2] / "migrations")
    scanner = scanner or ScannerConfig()
    return IngestionService(
        inbox=ScannerInbox(inbox_path, scanner),
        source_store=ImmutableFileStore(tmp_path / "spool"),
        artifact_store=ImmutableFileStore(tmp_path / "artifacts"),
        storage=database,
        limits=limits
        or LimitConfig(
            max_source_bytes=5_000_000,
            max_pages=5,
            max_pixels_per_page=2_000_000,
        ),
        scanner=scanner,
        bundle_fingerprint=BUNDLE,
    )


def _candidate(service: IngestionService, path: Path) -> Candidate:
    stat = path.stat()
    return Candidate(
        path,
        path.relative_to(service.inbox.root).as_posix(),
        FileObservation(stat.st_size, stat.st_mtime_ns),
    )


def _aligned_scan(path: Path, *, vertical_shift: int = 0) -> None:
    scale = 0.5
    width = round(CANONICAL_WIDTH * scale)
    height = round(CANONICAL_HEIGHT * scale)
    page = np.full((height, width), 255, dtype=np.uint8)
    for center_x, center_y in marker_centers():
        half = 11
        x = round(center_x * scale)
        y = round(center_y * scale)
        cv2.rectangle(page, (x - half, y - half), (x + half, y + half), 0, thickness=-1)
    for spec in crop_specs():
        left, top, right, bottom = spec.review_rect.pixels(width, height)
        if spec.kind in {"identifier-cell", "room-cell"}:
            cv2.rectangle(
                page,
                (left, top + vertical_shift),
                (right - 1, bottom - 1 + vertical_shift),
                0,
                thickness=1,
            )
        elif spec.kind == "item-name":
            cv2.line(
                page,
                (left, top + vertical_shift),
                (right, top + vertical_shift),
                0,
                thickness=1,
            )
            cv2.line(
                page,
                (left, bottom - 1 + vertical_shift),
                (right, bottom - 1 + vertical_shift),
                0,
                thickness=1,
            )
    row_rectangles = [
        spec.review_rect.pixels(width, height)
        for spec in crop_specs()
        if spec.kind in {"item-name", "item-quantity"}
    ]
    row_top = min(rectangle[1] for rectangle in row_rectangles) + vertical_shift
    row_bottom = max(rectangle[3] for rectangle in row_rectangles) + vertical_shift
    for x in sorted(
        {coordinate for rectangle in row_rectangles for coordinate in (rectangle[0], rectangle[2])}
    ):
        cv2.line(page, (x, row_top), (x, row_bottom), 0, thickness=1)
    Image.fromarray(page, mode="L").save(path)


def _aligned_skm_scan(path: Path) -> None:
    scale = 0.5
    width = round(CANONICAL_WIDTH * scale)
    height = round(CANONICAL_HEIGHT * scale)
    page = np.full((height, width), 255, dtype=np.uint8)
    for center_x, center_y in marker_centers():
        x = round(center_x * scale)
        y = round(center_y * scale)
        cv2.rectangle(page, (x - 11, y - 11), (x + 11, y + 11), 0, thickness=-1)
    for spec in skm_crop_specs():
        left, top, right, bottom = spec.review_rect.pixels(width, height)
        if spec.kind in {"identifier-cell", "room-cell"}:
            cv2.rectangle(page, (left, top), (right - 1, bottom - 1), 0, thickness=1)
        elif spec.kind == "item-name":
            cv2.line(page, (left, top), (right, top), 0, thickness=1)
            cv2.line(page, (left, bottom - 1), (right, bottom - 1), 0, thickness=1)
    rows = [
        spec.review_rect.pixels(width, height)
        for spec in skm_crop_specs()
        if spec.kind in {"item-name", "item-quantity"}
    ]
    for x in sorted({coordinate for row in rows for coordinate in (row[0], row[2])}):
        cv2.line(
            page,
            (x, min(row[1] for row in rows)),
            (x, max(row[3] for row in rows)),
            0,
            thickness=1,
        )
    Image.fromarray(page, mode="L").save(path)


def test_stability_tracker_requires_observation_count_and_elapsed_time(tmp_path: Path) -> None:
    path = tmp_path / "scan.png"
    path.write_bytes(b"stable")
    policy = ScannerConfig(
        stable_observations=3,
        stable_seconds=10,
        minimum_age_seconds=10,
    )
    tracker = StabilityTracker(policy)
    start = datetime.now(UTC) + timedelta(seconds=20)

    assert tracker.observe(path, start) is False
    assert tracker.observe(path, start + timedelta(seconds=5)) is False
    assert tracker.observe(path, start + timedelta(seconds=10)) is True


def test_ingestion_is_durable_and_exact_duplicates_reuse_jobs(tmp_path: Path) -> None:
    service = _service(tmp_path)
    first_path = service.inbox.root / "first.png"
    second_path = service.inbox.root / "renamed.png"
    Image.new("L", (120, 80), 240).save(first_path)
    second_path.write_bytes(first_path.read_bytes())

    first = service.ingest(_candidate(service, first_path))
    second = service.ingest(_candidate(service, second_path))

    assert first.source_id == second.source_id
    assert first.duplicate is False
    assert second.duplicate is True
    assert all(
        alignment.reason_code == "registration_markers_missing"
        for alignment in first.alignments
    )
    assert (service.source_store.root / first.local_path).read_bytes() == first_path.read_bytes()
    assert service.storage.status_counts() == {"queued": 1}
    with sqlite3.connect(service.storage.database_path) as connection:
        assert connection.execute(
            "SELECT disposition, reason_code FROM document_preprocessing"
        ).fetchone() == ("needs_review", "registration_markers_missing")


def test_accepted_observation_is_not_polled_repeatedly(tmp_path: Path) -> None:
    scanner = ScannerConfig(stable_observations=1, stable_seconds=0, minimum_age_seconds=0)
    service = _service(tmp_path, scanner=scanner)
    source = service.inbox.root / "accepted.png"
    Image.new("L", (120, 80), 240).save(source)

    service.ingest(_candidate(service, source))

    assert service.poll_once() == ()
    assert service.poll_once() == ()
    with sqlite3.connect(service.storage.database_path) as connection:
        assert connection.execute("SELECT COUNT(*) FROM source_discoveries").fetchone()[0] == 1


def test_poll_logs_rejected_source(tmp_path: Path, caplog: pytest.LogCaptureFixture) -> None:
    scanner = ScannerConfig(stable_observations=1, stable_seconds=0, minimum_age_seconds=0)
    service = _service(
        tmp_path,
        scanner=scanner,
        limits=LimitConfig(max_source_bytes=4, max_pages=5, max_pixels_per_page=2_000_000),
    )
    source = service.inbox.root / "oversized.pdf"
    source.write_bytes(b"%PDF!")

    with caplog.at_level(logging.WARNING, logger="order_scanner.ingestion"):
        assert service.poll_once() == ()
        assert service.poll_once() == ()
        assert service.poll_once() == ()

    assert "path=oversized.pdf" in caplog.text
    assert "reason=source_size_limit_exceeded" in caplog.text
    assert caplog.text.count("ingestion rejected;") == 1
    assert len(service.storage.ingestion_rejections()) == 1


def test_aligned_ingestion_persists_crop_provenance(tmp_path: Path) -> None:
    service = _service(tmp_path)
    source = service.inbox.root / "aligned.png"
    _aligned_scan(source)

    result = service.ingest(_candidate(service, source))

    assert len(result.crop_artifacts) == 68
    with sqlite3.connect(service.storage.database_path) as connection:
        count = connection.execute("SELECT COUNT(*) FROM artifacts").fetchone()[0]
        sample = connection.execute(
            """
            SELECT page_index, field_name, row_index, template_version
            FROM artifacts WHERE field_name='items.0.name' AND kind='review-crop'
            """
        ).fetchone()
        preprocessing = connection.execute(
            """
            SELECT disposition, reason_code, template_version
            FROM document_preprocessing
            """
        ).fetchone()
    assert count == 68
    assert sample == (0, "items.0.name", 0, "ticket-v4")
    assert preprocessing == ("aligned", None, "ticket-v4")

    replay_storage = Storage(
        tmp_path / "replayed-aligned.sqlite3",
        artifact_root=tmp_path / "artifacts",
    )
    replay_storage.migrate(Path(__file__).parents[2] / "migrations")
    replay = _service(tmp_path, storage=replay_storage)
    assert replay.reconcile_startup().receipts_replayed == 1
    with sqlite3.connect(replay_storage.database_path) as connection:
        assert connection.execute("SELECT COUNT(*) FROM artifacts").fetchone()[0] == 68
        assert connection.execute(
            "SELECT disposition FROM document_preprocessing"
        ).fetchone() == ("aligned",)


def test_skm_ingestion_persists_selected_template_provenance(tmp_path: Path) -> None:
    service = _service(tmp_path)
    source = service.inbox.root / "physical-scan.png"
    _aligned_skm_scan(source)

    result = service.ingest(_candidate(service, source))

    assert len(result.crop_artifacts) == 68
    assert result.alignments[0].template_version == SKM_TEMPLATE_VERSION
    with sqlite3.connect(service.storage.database_path) as connection:
        artifact_versions = connection.execute(
            "SELECT DISTINCT template_version FROM artifacts"
        ).fetchall()
        preprocessing = connection.execute(
            "SELECT disposition, template_version FROM document_preprocessing"
        ).fetchone()
    assert artifact_versions == [(SKM_TEMPLATE_VERSION,)]
    assert preprocessing == ("aligned", SKM_TEMPLATE_VERSION)


def test_shifted_template_geometry_persists_review_without_crops(tmp_path: Path) -> None:
    service = _service(tmp_path)
    source = service.inbox.root / "shifted.png"
    _aligned_scan(source, vertical_shift=9)

    result = service.ingest(_candidate(service, source))

    assert result.crop_artifacts == ()
    assert result.alignments[0].disposition is AlignmentDisposition.NEEDS_REVIEW
    assert result.alignments[0].reason_code == "template_geometry_mismatch"
    with sqlite3.connect(service.storage.database_path) as connection:
        assert connection.execute("SELECT COUNT(*) FROM artifacts").fetchone()[0] == 0
        assert connection.execute(
            "SELECT disposition, reason_code FROM document_preprocessing"
        ).fetchone() == ("needs_review", "template_geometry_mismatch")


def test_multi_page_ingestion_creates_all_page_jobs_together(tmp_path: Path) -> None:
    service = _service(tmp_path)
    source = service.inbox.root / "batch.tiff"
    frames = [Image.new("L", (120, 80), value) for value in (220, 230)]
    frames[0].save(source, format="TIFF", save_all=True, append_images=frames[1:])

    result = service.ingest(_candidate(service, source))

    assert len(result.pages) == 2
    assert result.pages[0].document_id != result.pages[1].document_id
    assert service.storage.status_counts() == {"queued": 2}


def test_changed_source_is_discarded_before_job_creation(tmp_path: Path) -> None:
    service = _service(tmp_path)
    source = service.inbox.root / "changing.png"
    Image.new("L", (120, 80), 240).save(source)
    candidate = _candidate(service, source)
    Image.new("L", (140, 80), 240).save(source)

    with pytest.raises(IngestionError) as error:
        service.ingest(candidate)

    assert error.value.reason_code == "source_changed_during_copy"
    assert service.storage.status_counts() == {}
    assert not tuple(service.source_store.staging.glob("*.tmp"))


def test_malformed_source_is_retained_in_local_quarantine(tmp_path: Path) -> None:
    service = _service(tmp_path)
    source = service.inbox.root / "bad.pdf"
    source.write_bytes(b"%PDF-1.7\nnot a document")

    with pytest.raises(IngestionError) as error:
        service.ingest(_candidate(service, source))

    assert error.value.reason_code == "malformed_pdf"
    assert error.value.local_path is not None
    assert (service.source_store.root / error.value.local_path).read_bytes() == source.read_bytes()


def test_startup_replays_durable_receipt_without_duplicate_discovery(tmp_path: Path) -> None:
    first = _service(tmp_path)
    source = first.inbox.root / "scan.png"
    Image.new("L", (120, 80), 240).save(source)
    first.ingest(_candidate(first, source))

    replay_storage = Storage(
        tmp_path / "replayed.sqlite3", artifact_root=tmp_path / "artifacts"
    )
    replay_storage.migrate(Path(__file__).parents[2] / "migrations")
    replay = _service(tmp_path, storage=replay_storage)

    first_report = replay.reconcile_startup()
    second_report = replay.reconcile_startup()

    assert first_report.receipts_replayed == 1
    assert second_report.receipts_replayed == 1
    assert replay_storage.status_counts() == {"queued": 1}


def test_startup_does_not_recompute_legacy_receipt_service_date(tmp_path: Path) -> None:
    first = _service(tmp_path)
    source = first.inbox.root / "legacy.png"
    Image.new("L", (120, 80), 240).save(source)
    first.ingest(_candidate(first, source))
    receipt_path = next((tmp_path / "spool" / "receipts").rglob("*.json"))
    receipt = json.loads(receipt_path.read_text(encoding="utf-8"))
    receipt.pop("service_date")
    receipt_path.write_text(json.dumps(receipt), encoding="utf-8")

    replay_storage = Storage(
        tmp_path / "legacy-replay.sqlite3", artifact_root=tmp_path / "artifacts"
    )
    replay_storage.migrate(Path(__file__).parents[2] / "migrations")
    report = _service(tmp_path, storage=replay_storage).reconcile_startup()

    assert report.receipts_replayed == 0
    assert report.legacy_receipts_without_service_date == 1
    assert replay_storage.status_counts() == {}
