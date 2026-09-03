from __future__ import annotations

import os
import time
from pathlib import Path

import numpy as np
import pytest

from order_scanner.artifacts import (
    ArtifactStoreError,
    ImmutableFileStore,
    write_crop_artifacts,
)
from order_scanner.imaging import CropPair
from order_scanner.template_v4 import CropSpec, NormalizedRect


def test_immutable_store_reuses_identical_bytes_and_rejects_conflicts(tmp_path: Path) -> None:
    store = ImmutableFileStore(tmp_path)

    first = store.put_bytes(
        identifier="artifact-1", content=b"first", namespace="crops", suffix=".png"
    )
    second = store.put_bytes(
        identifier="artifact-1", content=b"first", namespace="crops", suffix=".png"
    )

    assert first == second
    assert (tmp_path / first.relative_path).read_bytes() == b"first"
    with pytest.raises(ArtifactStoreError, match="different bytes"):
        store.put_bytes(
            identifier="artifact-1", content=b"second", namespace="crops", suffix=".png"
        )


def test_store_rejects_traversal_and_reconciles_only_owned_temporary_files(
    tmp_path: Path,
) -> None:
    store = ImmutableFileStore(tmp_path)
    with pytest.raises(ArtifactStoreError, match="traversal-free"):
        store.put_relative_bytes("../outside", b"unsafe")

    temporary = store.new_staging_path()
    temporary.write_bytes(b"partial")
    unrelated = store.staging / "operator-note.txt"
    unrelated.write_text("keep", encoding="utf-8")
    old = time.time() - 600
    os.utime(temporary, (old, old))
    os.utime(unrelated, (old, old))

    assert store.reconcile_staging(older_than_seconds=300) == 1
    assert not temporary.exists()
    assert unrelated.exists()


def test_store_rejects_symlinked_root_before_staging(tmp_path: Path) -> None:
    target = tmp_path / "target"
    target.mkdir()
    root = tmp_path / "spool"
    root.symlink_to(target, target_is_directory=True)

    with pytest.raises(ArtifactStoreError, match="root"):
        ImmutableFileStore(root).new_staging_path()


def test_crop_artifacts_are_deterministic_and_keep_review_and_inference_bytes(
    tmp_path: Path,
) -> None:
    image = np.full((10, 12), 255, dtype=np.uint8)
    image[2:5, 3:7] = 0
    spec = CropSpec(
        "items.0.name",
        "item-name",
        NormalizedRect(0.1, 0.1, 0.2, 0.2),
        NormalizedRect(0.11, 0.11, 0.19, 0.19),
        0,
    )
    crops = (CropPair(spec, image, image[1:-1, 1:-1]),)
    store = ImmutableFileStore(tmp_path)

    artifacts = write_crop_artifacts(
        store,
        document_id="doc-1",
        page_index=0,
        template_version="ticket-v4",
        crops=crops,
    )

    assert len(artifacts) == 2
    assert {artifact.kind for artifact in artifacts} == {"review-crop", "inference-crop"}
    assert all((tmp_path / artifact.relative_path).is_file() for artifact in artifacts)
