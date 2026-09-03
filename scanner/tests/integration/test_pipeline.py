import hashlib
from io import BytesIO
from pathlib import Path

import pytest
from PIL import Image

from order_scanner.artifacts import ImmutableFileStore
from order_scanner.contracts import PipelineVersions, ResultOutcome, utc_now
from order_scanner.pipeline import PageProcessor, PipelinePermanentError
from order_scanner.storage import IngestionArtifact, PreprocessingDisposition, Storage


def test_pipeline_commits_needs_review_result_and_outbox_atomically(tmp_path: Path) -> None:
    spool = tmp_path / "spool"
    artifact_root = tmp_path / "artifacts"
    spool.mkdir()
    source = b"stable source bytes"
    source_digest = hashlib.sha256(source).hexdigest()
    source_path = spool / "sources" / source_digest[:2] / f"{source_digest}.bin"
    source_path.parent.mkdir(parents=True)
    source_path.write_bytes(source)

    store = ImmutableFileStore(artifact_root)
    image_buffer = BytesIO()
    Image.new("L", (16, 16), color=255).save(image_buffer, format="PNG")
    crop = store.put_bytes(
        identifier="art_review",
        content=image_buffer.getvalue(),
        namespace="crops",
        suffix=".png",
    )
    storage = Storage(tmp_path / "state.sqlite3", artifact_root=artifact_root)
    storage.migrate(Path(__file__).parents[2] / "migrations")
    bundle = "a" * 64
    pages = storage.create_source_documents_jobs(
        source_identifier=f"src_{source_digest}",
        source_sha256=source_digest,
        byte_size=len(source),
        local_path=f"sources/{source_digest[:2]}/{source_digest}.bin",
        original_relative_path="capture.pdf",
        page_indexes=(0,),
        bundle_fingerprint=bundle,
        source_media_type="application/pdf",
        service_date="2026-08-04",
        artifacts=(
            IngestionArtifact(
                artifact_id="art_review",
                kind="review-crop",
                relative_path=crop.relative_path,
                media_type="image/png",
                sha256=crop.sha256,
                byte_size=crop.byte_size,
                pixel_width=16,
                pixel_height=16,
                page_index=0,
                field_name="items.0.name",
                row_index=0,
                template_version="ticket-v4",
            ),
        ),
        preprocessings=(
            PreprocessingDisposition(
                page_index=0,
                disposition="aligned",
                reason_code=None,
                source_markers=((1.0, 1.0),),
                marker_size_cv=0.01,
                reprojection_error_px=0.1,
                template_version="ticket-v4",
            ),
        ),
    )
    job = storage.claim_job(worker_id="processor", lease_seconds=300)
    assert job is not None
    versions = PipelineVersions(
        bundle, "1", "1.0-draft", "ticket-v4", "none", "none", "none", "catalogue-1"
    )
    processor = PageProcessor(
        storage=storage,
        artifact_store=store,
        source_root=spool,
        versions=versions,
        artifact_base_url="https://review.example.test",
        payload_max_bytes=512 * 1024,
        clock=utc_now,
    )

    mismatched_processor = PageProcessor(
        storage=storage,
        artifact_store=store,
        source_root=spool,
        versions=PipelineVersions(
            "b" * 64,
            "1",
            "1.0-draft",
            "ticket-v4",
            "none",
            "none",
            "none",
            "catalogue-1",
        ),
        artifact_base_url="https://review.example.test",
        payload_max_bytes=512 * 1024,
        clock=utc_now,
    )
    with pytest.raises(PipelinePermanentError, match="job_bundle_mismatch"):
        mismatched_processor.process(job)

    processed = processor.process(job)
    assert processed.result.outcome is ResultOutcome.NEEDS_REVIEW
    assert {artifact.kind for artifact in processed.result.artifacts} == {
        "source",
        "review-crop",
    }
    storage.complete_job(
        job_id=job.job_id,
        worker_id="processor",
        lease_epoch=job.lease_epoch,
        result=processed.result,
        callback=processed.callback,
    )
    assert storage.status_counts() == {"completed": 1}
    outbox = storage.outbox_row(processed.callback.event_id)
    assert outbox is not None
    assert bytes(outbox["payload_json"]) == processed.callback.to_json_bytes()
    assert pages[0].job_id == job.job_id
