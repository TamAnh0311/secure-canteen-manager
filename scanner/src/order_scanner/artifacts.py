from __future__ import annotations

import hashlib
import os
import re
import shutil
import time
import uuid
from dataclasses import dataclass
from io import BytesIO
from pathlib import Path, PurePosixPath

import numpy as np
from PIL import Image

from order_scanner.imaging import CropPair


class ArtifactStoreError(RuntimeError):
    """An immutable local file could not be stored safely."""


@dataclass(frozen=True, slots=True)
class StoredFile:
    relative_path: str
    sha256: str
    byte_size: int


@dataclass(frozen=True, slots=True)
class CropArtifact:
    artifact_id: str
    field_name: str
    kind: str
    relative_path: str
    sha256: str
    byte_size: int
    pixel_width: int
    pixel_height: int
    page_index: int
    row_index: int | None
    template_version: str


class ImmutableFileStore:
    def __init__(self, root: str | Path) -> None:
        self.root = Path(root)
        self.staging = self.root / ".staging"

    def put_bytes(
        self,
        *,
        identifier: str,
        content: bytes,
        namespace: str,
        suffix: str,
    ) -> StoredFile:
        _validate_identifier(identifier)
        _validate_namespace(namespace)
        if suffix and (not suffix.startswith(".") or "/" in suffix or "\\" in suffix):
            raise ArtifactStoreError("artifact suffix must be a simple file extension")
        relative = PurePosixPath(namespace, identifier[:2], f"{identifier}{suffix}")
        return self.put_relative_bytes(relative.as_posix(), content)

    def put_relative_bytes(self, relative_path: str, content: bytes) -> StoredFile:
        target = self._target(relative_path)
        digest = hashlib.sha256(content).hexdigest()
        if target.exists():
            return self._verify_existing(target, relative_path, digest, len(content))

        temporary = self.new_staging_path()
        try:
            with temporary.open("xb") as handle:
                handle.write(content)
                handle.flush()
                os.fsync(handle.fileno())
            target.parent.mkdir(parents=True, exist_ok=True)
            if target.exists():
                return self._verify_existing(target, relative_path, digest, len(content))
            os.replace(temporary, target)
            _fsync_directory(target.parent)
        except OSError as exc:
            raise ArtifactStoreError(f"cannot store immutable file: {type(exc).__name__}") from None
        finally:
            temporary.unlink(missing_ok=True)
        return StoredFile(relative_path, digest, len(content))

    def copy_from_path(
        self,
        *,
        source_path: str | Path,
        relative_path: str,
        expected_sha256: str,
        expected_size: int,
    ) -> StoredFile:
        """Copy a verified source into the immutable store without buffering it all."""
        source = Path(source_path)
        if source.is_symlink() or not source.is_file():
            raise ArtifactStoreError("source file must be a regular file")
        staged = self.new_staging_path()
        digest = hashlib.sha256()
        size = 0
        try:
            with source.open("rb") as input_handle, staged.open("xb") as output_handle:
                while chunk := input_handle.read(1024 * 1024):
                    digest.update(chunk)
                    size += len(chunk)
                    output_handle.write(chunk)
                output_handle.flush()
                os.fsync(output_handle.fileno())
            if digest.hexdigest() != expected_sha256 or size != expected_size:
                raise ArtifactStoreError("source bytes do not match expected metadata")
            return self.promote_staged(
                staged_path=staged,
                relative_path=relative_path,
                expected_sha256=expected_sha256,
                expected_size=expected_size,
            )
        except OSError as exc:
            raise ArtifactStoreError(f"cannot copy source file: {type(exc).__name__}") from None
        finally:
            staged.unlink(missing_ok=True)

    def verify_relative(
        self, relative_path: str, expected_sha256: str, expected_size: int
    ) -> StoredFile:
        target = self._target(relative_path)
        if not target.is_file():
            raise ArtifactStoreError("immutable file is missing")
        return self._verify_existing(target, relative_path, expected_sha256, expected_size)

    def promote_staged(
        self,
        *,
        staged_path: Path,
        relative_path: str,
        expected_sha256: str,
        expected_size: int,
    ) -> StoredFile:
        target = self._target(relative_path)
        if target.exists():
            staged_path.unlink(missing_ok=True)
            return self._verify_existing(
                target, relative_path, expected_sha256, expected_size
            )
        target.parent.mkdir(parents=True, exist_ok=True)
        try:
            os.replace(staged_path, target)
            _fsync_directory(target.parent)
        except OSError as exc:
            raise ArtifactStoreError(
                f"cannot promote immutable file: {type(exc).__name__}"
            ) from None
        return self._verify_existing(target, relative_path, expected_sha256, expected_size)

    def new_staging_path(self) -> Path:
        self._assert_safe_root()
        self.root.mkdir(parents=True, exist_ok=True)
        if self.staging.exists() and self.staging.is_symlink():
            raise ArtifactStoreError("staging directory must not be a symlink")
        self.staging.mkdir(parents=True, exist_ok=True)
        return self.staging / f"{uuid.uuid4().hex}.tmp"

    def reconcile_staging(self, *, older_than_seconds: int = 300) -> int:
        if older_than_seconds < 0:
            raise ArtifactStoreError("staging age must not be negative")
        self._assert_safe_root()
        if not self.staging.exists():
            return 0
        if self.staging.is_symlink() or not self.staging.is_dir():
            raise ArtifactStoreError("staging directory must be a regular directory")
        cutoff = time.time_ns() - older_than_seconds * 1_000_000_000
        removed = 0
        for path in self.staging.iterdir():
            if not path.is_file() or re.fullmatch(r"[0-9a-f]{32}\.tmp", path.name) is None:
                continue
            try:
                if path.stat().st_mtime_ns <= cutoff:
                    path.unlink()
                    removed += 1
            except FileNotFoundError:
                continue
        return removed

    def reconcile_decode_directories(self, *, older_than_seconds: int = 300) -> int:
        if older_than_seconds < 0:
            raise ArtifactStoreError("decode directory age must not be negative")
        cutoff = time.time_ns() - older_than_seconds * 1_000_000_000
        removed = 0
        self._assert_safe_root()
        if not self.root.is_dir():
            return 0
        for path in self.root.iterdir():
            if (
                path.is_symlink()
                or not path.is_dir()
                or re.fullmatch(r"decode-[A-Za-z0-9_.-]+", path.name) is None
            ):
                continue
            try:
                if path.stat().st_mtime_ns <= cutoff:
                    shutil.rmtree(path)
                    removed += 1
            except FileNotFoundError:
                continue
        return removed

    def _target(self, relative_path: str) -> Path:
        self._assert_safe_root()
        pure = PurePosixPath(relative_path)
        if (
            not relative_path
            or "\\" in relative_path
            or pure.is_absolute()
            or ".." in pure.parts
        ):
            raise ArtifactStoreError("artifact path must be relative and traversal-free")
        target = self.root.joinpath(*pure.parts)
        if target == self.staging or self.staging in target.parents:
            raise ArtifactStoreError("artifact path must not target the staging directory")
        current = self.root
        if current.is_symlink():
            raise ArtifactStoreError("artifact root must not be a symlink")
        for part in pure.parts[:-1]:
            current /= part
            if current.is_symlink():
                raise ArtifactStoreError("artifact path contains a symlinked directory")
        if target.is_symlink():
            raise ArtifactStoreError("artifact path must not be a symlink")
        return target

    def _assert_safe_root(self) -> None:
        if self.root.exists() and (self.root.is_symlink() or not self.root.is_dir()):
            raise ArtifactStoreError("artifact root must be a regular directory")

    @staticmethod
    def _verify_existing(
        target: Path,
        relative_path: str,
        expected_sha256: str,
        expected_size: int,
    ) -> StoredFile:
        digest = hashlib.sha256()
        size = 0
        try:
            with target.open("rb") as handle:
                while chunk := handle.read(1024 * 1024):
                    digest.update(chunk)
                    size += len(chunk)
        except OSError as exc:
            raise ArtifactStoreError(
                f"cannot verify immutable file: {type(exc).__name__}"
            ) from None
        if size != expected_size or digest.hexdigest() != expected_sha256:
            raise ArtifactStoreError("immutable path already contains different bytes")
        return StoredFile(relative_path, expected_sha256, expected_size)


def _validate_identifier(value: str) -> None:
    if re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._-]{0,127}", value) is None:
        raise ArtifactStoreError("artifact identifier is invalid")


def _validate_namespace(value: str) -> None:
    if re.fullmatch(r"[a-z][a-z0-9-]{0,31}", value) is None:
        raise ArtifactStoreError("artifact namespace is invalid")


def _fsync_directory(path: Path) -> None:
    if os.name == "nt":
        return
    descriptor = os.open(path, os.O_RDONLY)
    try:
        os.fsync(descriptor)
    finally:
        os.close(descriptor)


def write_crop_artifacts(
    store: ImmutableFileStore,
    *,
    document_id: str,
    page_index: int,
    template_version: str,
    crops: tuple[CropPair, ...],
) -> tuple[CropArtifact, ...]:
    if page_index < 0:
        raise ArtifactStoreError("crop page_index must be zero-based")
    if not template_version:
        raise ArtifactStoreError("crop template_version is required")
    artifacts: list[CropArtifact] = []
    for crop in crops:
        for kind, image in (("review-crop", crop.review), ("inference-crop", crop.inference)):
            artifact_id = "art_" + hashlib.sha256(
                f"{document_id}\x1f{page_index}\x1f{crop.spec.field_name}\x1f{kind}".encode()
            ).hexdigest()
            content = _encode_png(image)
            stored = store.put_bytes(
                identifier=artifact_id,
                content=content,
                namespace="crops",
                suffix=".png",
            )
            artifacts.append(
                CropArtifact(
                    artifact_id=artifact_id,
                    field_name=crop.spec.field_name,
                    kind=kind,
                    relative_path=stored.relative_path,
                    sha256=stored.sha256,
                    byte_size=stored.byte_size,
                    pixel_width=int(image.shape[1]),
                    pixel_height=int(image.shape[0]),
                    page_index=page_index,
                    row_index=crop.spec.row_index,
                    template_version=template_version,
                )
            )
    return tuple(artifacts)


def _encode_png(image: np.ndarray) -> bytes:
    if image.dtype != np.uint8 or image.ndim != 2:
        raise ArtifactStoreError("crop must be an 8-bit grayscale image")
    output = BytesIO()
    Image.fromarray(image, mode="L").save(output, format="PNG", optimize=False)
    return output.getvalue()
