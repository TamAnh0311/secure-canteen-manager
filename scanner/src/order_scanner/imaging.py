from __future__ import annotations

import importlib
import json
import math
import multiprocessing
import os
import platform
import warnings
from dataclasses import asdict, dataclass
from enum import StrEnum
from pathlib import Path
from typing import Any, TypeAlias, cast

import cv2 as _cv2
import numpy as np
from numpy.typing import NDArray
from PIL import Image, ImageOps, UnidentifiedImageError

from order_scanner.template_skm import (
    IDENTIFIER_CELL_COUNT as SKM_IDENTIFIER_CELL_COUNT,
)
from order_scanner.template_skm import (
    TEMPLATE_VERSION as SKM_TEMPLATE_VERSION,
)
from order_scanner.template_skm import (
    crop_specs as skm_crop_specs,
)
from order_scanner.template_v4 import (
    CANONICAL_DPI,
    CANONICAL_HEIGHT,
    CANONICAL_WIDTH,
    MARKER_SIZE_POINTS,
    TEMPLATE_VERSION,
    CropSpec,
    marker_centers,
)
from order_scanner.template_v4 import (
    crop_specs as ticket_v4_crop_specs,
)

GrayImage: TypeAlias = NDArray[np.uint8]
cv2: Any = _cv2

# Apple Notes PDF rendering leaves form borders light enough to need a wider ink range.
_IDENTIFIER_GRID_PIXEL_THRESHOLD = 210
_TEMPLATE_GEOMETRY_SEARCH_RADIUS_PX = 24
_TEMPLATE_GEOMETRY_TOLERANCE_PX = 8
_TEMPLATE_BOUNDARY_MIN_INK_RATIO = 0.12
_MARKER_ADAPTIVE_WINDOW_FRACTION = 0.08
_MARKER_ADAPTIVE_MIN_THRESHOLD = 100


class ImagingError(RuntimeError):
    """An input could not be decoded or aligned safely."""


class DecodeError(ImagingError):
    def __init__(self, reason_code: str, detail: str) -> None:
        super().__init__(detail)
        self.reason_code = reason_code


class AlignmentDisposition(StrEnum):
    ALIGNED = "aligned"
    NEEDS_REVIEW = "needs_review"


@dataclass(frozen=True, slots=True)
class DecodeLimits:
    max_pages: int
    max_pixels_per_page: int
    timeout_seconds: int
    memory_mb: int
    pdf_dpi: int = 150


@dataclass(frozen=True, slots=True)
class DecodedPage:
    page_index: int
    array_path: Path
    width: int
    height: int

    def load(self) -> GrayImage:
        value = np.load(self.array_path, allow_pickle=False)
        if value.dtype != np.uint8 or value.ndim != 2:
            raise DecodeError("invalid_worker_output", "decoded page array is invalid")
        return cast(GrayImage, value)


@dataclass(frozen=True, slots=True)
class DecodedDocument:
    media_type: str
    pages: tuple[DecodedPage, ...]


@dataclass(frozen=True, slots=True)
class AlignmentResult:
    disposition: AlignmentDisposition
    reason_code: str | None
    aligned: GrayImage | None
    source_markers: tuple[tuple[float, float], ...]
    marker_size_cv: float | None
    reprojection_error_px: float | None
    template_version: str | None = None


@dataclass(frozen=True, slots=True)
class CropPair:
    spec: CropSpec
    review: GrayImage
    inference: GrayImage


@dataclass(frozen=True, slots=True)
class BlankRowFeatures:
    row_index: int
    ink_ratio: float
    component_count: int


@dataclass(frozen=True, slots=True)
class _TemplateProfile:
    version: str
    identifier_cell_count: int
    crops: tuple[CropSpec, ...]
    geometry_tolerance_px: float


_TICKET_V4_PROFILE = _TemplateProfile(
    TEMPLATE_VERSION, 6, ticket_v4_crop_specs(), _TEMPLATE_GEOMETRY_TOLERANCE_PX
)
_SKM_PROFILE = _TemplateProfile(
    SKM_TEMPLATE_VERSION,
    SKM_IDENTIFIER_CELL_COUNT,
    skm_crop_specs(),
    9.0,
)
_TEMPLATE_PROFILES = (_TICKET_V4_PROFILE, _SKM_PROFILE)


class _WorkerFailure(RuntimeError):
    def __init__(self, reason_code: str, detail: str) -> None:
        super().__init__(detail)
        self.reason_code = reason_code


def decode_document(
    source_path: str | Path,
    output_directory: str | Path,
    limits: DecodeLimits,
) -> DecodedDocument:
    source = Path(source_path)
    output = Path(output_directory)
    output.mkdir(parents=True, exist_ok=True)
    result_path = output / "decode-result.json"
    context = multiprocessing.get_context("spawn")
    process = context.Process(
        target=_decode_worker,
        args=(str(source), str(output), asdict(limits)),
        daemon=False,
    )
    process.start()
    process.join(limits.timeout_seconds)
    if process.is_alive():
        process.terminate()
        process.join(2)
        if process.is_alive() and process.pid is not None:
            process.kill()
            process.join()
        raise DecodeError("decode_timeout", "input decoding exceeded the configured timeout")
    if process.exitcode != 0 or not result_path.is_file():
        raise DecodeError("decoder_crash", "isolated decoder exited without a valid result")
    try:
        payload = json.loads(result_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        raise DecodeError(
            "invalid_worker_output", "isolated decoder returned invalid metadata"
        ) from None
    if not isinstance(payload, dict) or payload.get("status") != "ok":
        reason = (
            payload.get("reason_code", "decode_failed")
            if isinstance(payload, dict)
            else "decode_failed"
        )
        detail = (
            payload.get("detail", "input decoding failed")
            if isinstance(payload, dict)
            else "input decoding failed"
        )
        raise DecodeError(str(reason), str(detail))
    raw_pages = payload.get("pages")
    if not isinstance(raw_pages, list) or not raw_pages:
        raise DecodeError("invalid_worker_output", "decoder returned no pages")
    try:
        parsed_pages: list[DecodedPage] = []
        for expected_index, item in enumerate(raw_pages):
            if not isinstance(item, dict):
                raise ValueError("page metadata is not an object")
            page_index = int(item["page_index"])
            filename = str(item["filename"])
            width = int(item["width"])
            height = int(item["height"])
            if (
                page_index != expected_index
                or filename != f"page-{page_index:04d}.npy"
                or width < 1
                or height < 1
            ):
                raise ValueError("page metadata is invalid")
            parsed_pages.append(DecodedPage(page_index, output / filename, width, height))
        pages = tuple(parsed_pages)
    except (KeyError, TypeError, ValueError, OverflowError):
        raise DecodeError(
            "invalid_worker_output", "isolated decoder returned invalid page metadata"
        ) from None
    if any(not page.array_path.is_file() for page in pages):
        raise DecodeError("invalid_worker_output", "decoded page data is missing")
    media_type = payload.get("media_type")
    if media_type not in {"application/pdf", "image/png", "image/jpeg", "image/tiff"}:
        raise DecodeError("invalid_worker_output", "isolated decoder returned invalid media type")
    return DecodedDocument(str(media_type), pages)


def align_page(image: GrayImage) -> AlignmentResult:
    if image.dtype != np.uint8 or image.ndim != 2:
        raise ImagingError("alignment requires an 8-bit grayscale page")
    markers, sizes, centroid_offsets = _detect_markers(image)
    if len(markers) != 4:
        return AlignmentResult(
            AlignmentDisposition.NEEDS_REVIEW,
            "registration_markers_missing",
            None,
            markers,
            None,
            None,
        )
    mean_size = float(np.mean(sizes))
    size_cv = float(np.std(sizes) / mean_size) if mean_size else math.inf
    if size_cv > 0.35:
        return AlignmentResult(
            AlignmentDisposition.NEEDS_REVIEW,
            "registration_marker_size_mismatch",
            None,
            markers,
            size_cv,
            None,
        )
    height, width = image.shape
    canonical_aspect = CANONICAL_WIDTH / CANONICAL_HEIGHT
    observed_aspect = width / height
    cropped_page = abs(observed_aspect - canonical_aspect) / canonical_aspect > 0.02
    centroid_tolerance = 0.03 if cropped_page else 0.012
    if any(
        math.hypot(offset_x, offset_y) > centroid_tolerance
        for offset_x, offset_y in centroid_offsets
    ):
        return AlignmentResult(
            AlignmentDisposition.NEEDS_REVIEW,
            "registration_marker_clipped",
            None,
            markers,
            size_cv,
            None,
        )
    expected_size = (
        MARKER_SIZE_POINTS
        * CANONICAL_DPI
        / 72
        * math.sqrt((width * height) / (CANONICAL_WIDTH * CANONICAL_HEIGHT))
    )
    if mean_size < expected_size * 0.82:
        return AlignmentResult(
            AlignmentDisposition.NEEDS_REVIEW,
            "registration_marker_clipped",
            None,
            markers,
            size_cv,
            None,
        )
    edge_margin = mean_size * (0.4 if cropped_page else 0.5)
    if any(
        x < edge_margin
        or y < edge_margin
        or width - x < edge_margin
        or height - y < edge_margin
        for x, y in markers
    ):
        return AlignmentResult(
            AlignmentDisposition.NEEDS_REVIEW,
            "registration_marker_clipped",
            None,
            markers,
            size_cv,
            None,
        )
    source = np.asarray(markers, dtype=np.float32)
    target = np.asarray(marker_centers(), dtype=np.float32)
    if not cv2.isContourConvex(source.reshape((-1, 1, 2)).astype(np.int32)):
        return AlignmentResult(
            AlignmentDisposition.NEEDS_REVIEW,
            "registration_marker_order_invalid",
            None,
            markers,
            size_cv,
            None,
        )
    candidates: list[tuple[float, GrayImage, float, _TemplateProfile, int, float]] = []
    for points in (source, source[[2, 3, 0, 1]]):
        candidate = _warp_candidate(image, points, target)
        if candidate is not None:
            aligned, reprojection_error = candidate
            for profile in _TEMPLATE_PROFILES:
                candidates.append(
                    (
                        _structure_score(aligned),
                        aligned,
                        reprojection_error,
                        profile,
                        _identifier_grid_cell_count(aligned, profile),
                        _template_geometry_error_px(aligned, profile),
                    )
                )
    if not candidates:
        return AlignmentResult(
            AlignmentDisposition.NEEDS_REVIEW,
            "registration_reprojection_failed",
            None,
            markers,
            size_cv,
            None,
        )
    candidates.sort(key=lambda item: item[0], reverse=True)
    matching_candidates = [
        candidate
        for candidate in candidates
        if candidate[4] == candidate[3].identifier_cell_count
    ]
    if not matching_candidates:
        _score, _aligned, reprojection_error, _profile, _grid_count, _geometry_error = (
            candidates[0]
        )
        return AlignmentResult(
            AlignmentDisposition.NEEDS_REVIEW,
            "template_identifier_grid_mismatch",
            None,
            markers,
            size_cv,
            reprojection_error,
        )
    geometry_candidates = [
        candidate
        for candidate in matching_candidates
        if candidate[5] <= candidate[3].geometry_tolerance_px
    ]
    if not geometry_candidates:
        _score, _aligned, reprojection_error, _profile, _grid_count, _geometry_error = min(
            matching_candidates, key=lambda item: item[5]
        )
        return AlignmentResult(
            AlignmentDisposition.NEEDS_REVIEW,
            "template_geometry_mismatch",
            None,
            markers,
            size_cv,
            reprojection_error,
        )
    geometry_candidates.sort(key=lambda item: (item[5], -item[0]))
    if (
        len(geometry_candidates) > 1
        and geometry_candidates[0][3].version == geometry_candidates[1][3].version
        and abs(geometry_candidates[0][0] - geometry_candidates[1][0]) < 0.002
    ):
        return AlignmentResult(
            AlignmentDisposition.NEEDS_REVIEW,
            "registration_orientation_ambiguous",
            None,
            markers,
            size_cv,
            geometry_candidates[0][2],
        )
    _score, aligned, reprojection_error, profile, _grid_count, _geometry_error = (
        geometry_candidates[0]
    )
    return AlignmentResult(
        AlignmentDisposition.ALIGNED,
        None,
        aligned,
        markers,
        size_cv,
        reprojection_error,
        profile.version,
    )


def _warp_candidate(
    image: GrayImage, source: NDArray[np.float32], target: NDArray[np.float32]
) -> tuple[GrayImage, float] | None:
    if not cv2.isContourConvex(source.reshape((-1, 1, 2)).astype(np.int32)):
        return None
    transform = cv2.getPerspectiveTransform(source, target)
    if not np.isfinite(transform).all() or abs(float(np.linalg.det(transform))) < 1e-10:
        return None
    aligned = cast(
        GrayImage,
        cv2.warpPerspective(
            image,
            transform,
            (CANONICAL_WIDTH, CANONICAL_HEIGHT),
            flags=cv2.INTER_LINEAR,
            borderMode=cv2.BORDER_CONSTANT,
            borderValue=255,
        ),
    )
    aligned_markers, _aligned_sizes, _aligned_offsets = _detect_markers(aligned)
    if len(aligned_markers) != 4:
        return None
    reprojection_error = float(
        np.sqrt(
            np.mean(
                np.sum(
                    (np.asarray(aligned_markers) - target.astype(np.float64)) ** 2,
                    axis=1,
                )
            )
        )
    )
    if reprojection_error > 3.0:
        return None
    return aligned, reprojection_error


def _structure_score(
    image: GrayImage, profile: _TemplateProfile = _TICKET_V4_PROFILE
) -> float:
    boundaries: list[int] = []
    x_left = 0
    x_right = CANONICAL_WIDTH
    for spec in profile.crops:
        if spec.kind == "item-name" and spec.row_index is not None:
            left, top, right, bottom = spec.review_rect.pixels(
                CANONICAL_WIDTH, CANONICAL_HEIGHT
            )
            if spec.row_index == 0:
                x_left, x_right = left, right
            boundaries.extend((top, bottom))
    if not boundaries:
        return 0.0
    scores = []
    for y in boundaries:
        band = image[max(0, y - 2) : min(image.shape[0], y + 3), x_left:x_right]
        scores.append(float(np.mean(255 - band)) / 255)
    return float(np.mean(scores))


def _identifier_grid_cell_count(image: GrayImage, profile: _TemplateProfile) -> int:
    """Count the durable vertical borders in the fixed identifier grid."""
    identifier_specs = tuple(
        spec for spec in profile.crops if spec.kind == "identifier-cell"
    )
    rectangles = tuple(
        spec.review_rect.pixels(CANONICAL_WIDTH, CANONICAL_HEIGHT)
        for spec in identifier_specs
    )
    left = min(rectangle[0] for rectangle in rectangles)
    top = min(rectangle[1] for rectangle in rectangles)
    right = max(rectangle[2] for rectangle in rectangles)
    bottom = max(rectangle[3] for rectangle in rectangles)
    expected_borders = sorted(
        {coordinate for rectangle in rectangles for coordinate in (rectangle[0], rectangle[2])}
    )
    cell = round(float(np.median(np.diff(expected_borders))))
    probe_borders = expected_borders + [
        right + cell * index for index in range(1, 5)
    ]
    region = np.where(
        image[max(0, top - 8) : bottom + 8, left : min(image.shape[1], probe_borders[-1] + 6)]
        < _IDENTIFIER_GRID_PIXEL_THRESHOLD,
        255,
        0,
    )
    opened = cv2.morphologyEx(
        region.astype(np.uint8),
        cv2.MORPH_OPEN,
        cv2.getStructuringElement(cv2.MORPH_RECT, (1, max(9, round(cell * 0.62)))),
    )
    border_presence: list[bool] = []
    for border in probe_borders:
        x = border - left
        band = opened[:, max(0, x - 5) : min(opened.shape[1], x + 6)]
        score = float(np.count_nonzero(band)) / band.size if band.size else 0.0
        # Handwriting can interrupt a border's middle. Prefer the durable top
        # and bottom portions of the box when scoring physical scans.
        edge_band = np.concatenate((band[:10], band[-10:]), axis=0)
        edge_score = (
            float(np.count_nonzero(edge_band)) / edge_band.size
            if edge_band.size
            else 0.0
        )
        border_presence.append(score > 0.15 or edge_score > 0.08)
    borders = 0
    for present in border_presence:
        if not present:
            break
        borders += 1
    return max(0, borders - 1)


def _template_geometry_error_px(image: GrayImage, profile: _TemplateProfile) -> float:
    """Measure fixed crop boundaries against the aligned template raster."""
    spec_groups = (
        tuple(spec for spec in profile.crops if spec.kind == "identifier-cell"),
        tuple(spec for spec in profile.crops if spec.kind == "room-cell"),
        tuple(
            spec
            for spec in profile.crops
            if spec.kind in {"item-name", "item-quantity"}
        ),
    )
    errors: list[int] = []
    for specs in spec_groups:
        rectangles = tuple(
            spec.review_rect.pixels(CANONICAL_WIDTH, CANONICAL_HEIGHT)
            for spec in specs
        )
        left = min(rectangle[0] for rectangle in rectangles)
        top = min(rectangle[1] for rectangle in rectangles)
        right = max(rectangle[2] for rectangle in rectangles)
        bottom = max(rectangle[3] for rectangle in rectangles)
        expected_x = sorted(
            {coordinate for rectangle in rectangles for coordinate in (rectangle[0], rectangle[2])}
        )
        expected_y = sorted(
            {coordinate for rectangle in rectangles for coordinate in (rectangle[1], rectangle[3])}
        )
        for x in expected_x:
            observed = _nearest_boundary(
                image,
                expected=x,
                span_start=max(0, top - _TEMPLATE_GEOMETRY_SEARCH_RADIUS_PX),
                span_end=min(image.shape[0], bottom + _TEMPLATE_GEOMETRY_SEARCH_RADIUS_PX),
                vertical=True,
            )
            if observed is None:
                return math.inf
            errors.append(abs(observed - x))
        for y in expected_y:
            observed = _nearest_boundary(
                image,
                expected=y,
                span_start=max(0, left - _TEMPLATE_GEOMETRY_SEARCH_RADIUS_PX),
                span_end=min(image.shape[1], right + _TEMPLATE_GEOMETRY_SEARCH_RADIUS_PX),
                vertical=False,
            )
            if observed is None:
                return math.inf
            errors.append(abs(observed - y))
    return float(max(errors, default=0))


def _nearest_boundary(
    image: GrayImage,
    *,
    expected: int,
    span_start: int,
    span_end: int,
    vertical: bool,
) -> int | None:
    search_start = max(0, expected - _TEMPLATE_GEOMETRY_SEARCH_RADIUS_PX)
    search_limit = image.shape[1] if vertical else image.shape[0]
    search_end = min(search_limit, expected + _TEMPLATE_GEOMETRY_SEARCH_RADIUS_PX + 1)
    region = (
        image[span_start:span_end, search_start:search_end]
        if vertical
        else image[search_start:search_end, span_start:span_end]
    )
    if region.size == 0:
        return None
    ink = region < _IDENTIFIER_GRID_PIXEL_THRESHOLD
    scores = np.mean(ink, axis=0 if vertical else 1)
    smoothed = np.convolve(scores, np.ones(3) / 3, mode="same")
    index = int(np.argmax(smoothed))
    if float(smoothed[index]) < _TEMPLATE_BOUNDARY_MIN_INK_RATIO:
        return None
    return search_start + index


def extract_crops(
    aligned: GrayImage, template_version: str = TEMPLATE_VERSION
) -> tuple[CropPair, ...]:
    if aligned.shape != (CANONICAL_HEIGHT, CANONICAL_WIDTH):
        raise ImagingError("crop extraction requires the canonical template raster")
    profile = _profile_for_version(template_version)
    crops: list[CropPair] = []
    for spec in profile.crops:
        review = _crop(aligned, spec.review_rect.pixels(CANONICAL_WIDTH, CANONICAL_HEIGHT))
        inference = _crop(
            aligned, spec.inference_rect.pixels(CANONICAL_WIDTH, CANONICAL_HEIGHT)
        )
        crops.append(CropPair(spec, review.copy(), inference.copy()))
    return tuple(crops)


def _profile_for_version(template_version: str) -> _TemplateProfile:
    for profile in _TEMPLATE_PROFILES:
        if profile.version == template_version:
            return profile
    raise ImagingError(f"unsupported template version: {template_version}")


def blank_row_features(crops: tuple[CropPair, ...]) -> tuple[BlankRowFeatures, ...]:
    by_row: dict[int, list[GrayImage]] = {}
    for crop in crops:
        if crop.spec.row_index is not None:
            by_row.setdefault(crop.spec.row_index, []).append(crop.inference)
    features: list[BlankRowFeatures] = []
    for row_index in range(12):
        row_crops = by_row.get(row_index, [])
        if len(row_crops) != 2:
            raise ImagingError("each item row must contain name and quantity crops")
        total_pixels = sum(int(crop.size) for crop in row_crops)
        ink_pixels = 0
        components = 0
        for row_image in row_crops:
            _threshold, binary = cv2.threshold(
                row_image, 0, 255, cv2.THRESH_BINARY_INV | cv2.THRESH_OTSU
            )
            ink_pixels += int(np.count_nonzero(binary))
            count, _labels, stats, _centroids = cv2.connectedComponentsWithStats(binary)
            components += sum(int(stats[index, cv2.CC_STAT_AREA]) >= 4 for index in range(1, count))
        features.append(
            BlankRowFeatures(row_index, ink_pixels / max(total_pixels, 1), components)
        )
    return tuple(features)


def visual_fingerprint(aligned: GrayImage) -> str:
    reduced = cv2.resize(aligned, (9, 8), interpolation=cv2.INTER_AREA)
    bits = reduced[:, 1:] > reduced[:, :-1]
    value = 0
    for bit in bits.flat:
        value = (value << 1) | int(bit)
    return f"{value:016x}"


def fingerprint_distance(left: str, right: str) -> int:
    if len(left) != 16 or len(right) != 16:
        raise ImagingError("visual fingerprints must be 64-bit hexadecimal values")
    try:
        return (int(left, 16) ^ int(right, 16)).bit_count()
    except ValueError:
        raise ImagingError("visual fingerprints must be hexadecimal") from None


def _detect_markers(
    image: GrayImage,
) -> tuple[
    tuple[tuple[float, float], ...],
    tuple[float, ...],
    tuple[tuple[float, float], ...],
]:
    minimum_side = min(image.shape) * 0.012
    maximum_side = min(image.shape) * 0.06
    height, width = image.shape
    quadrants: tuple[tuple[float, float], ...] = (
        (0.0, 0.0),
        (float(width), 0.0),
        (float(width), float(height)),
        (0.0, float(height)),
    )
    # Phone/PDF pipelines often lift marker black into the mid-grey range. Keep
    # the fixed threshold fast path, then use local thresholds for scanner pages
    # whose corner markers have different tonal treatment.
    binary = cast(GrayImage, np.where(image < 140, 255, 0).astype(np.uint8))
    candidates = _marker_candidates(binary, image, minimum_side, maximum_side)
    adaptive_used = False
    has_intermediate_tones = bool(np.any((image > 0) & (image < 255)))
    if len(candidates) != 4 and has_intermediate_tones:
        candidates = _adaptive_marker_candidates(
            image, minimum_side, maximum_side, width, height
        )
        adaptive_used = True
    if len(candidates) != 4:
        return (), (), ()

    selected: list[tuple[float, float, float, float, float, float]] = []
    remaining = candidates.copy()
    for corner_x, corner_y in quadrants:
        choice = min(
            remaining,
            key=lambda item: (item[0] - corner_x) ** 2 + (item[1] - corner_y) ** 2,
        )
        selected.append(choice)
        remaining.remove(choice)

    # getPerspectiveTransform expects top-left, top-right, bottom-right, bottom-left.
    points = tuple((item[0], item[1]) for item in selected)
    sizes = tuple(item[2] for item in selected)
    centroid_offsets = tuple((item[4], item[5]) for item in selected)
    expected_points = tuple(
        (
            center_x / CANONICAL_WIDTH * width,
            center_y / CANONICAL_HEIGHT * height,
        )
        for center_x, center_y in marker_centers()
    )
    canonical_aspect = CANONICAL_WIDTH / CANONICAL_HEIGHT
    observed_aspect = width / height
    cropped_page = abs(observed_aspect - canonical_aspect) / canonical_aspect > 0.02
    position_tolerance = min(width, height) * (
        0.04 if cropped_page or adaptive_used else 0.019
    )
    if any(
        math.hypot(point[0] - expected[0], point[1] - expected[1])
        > position_tolerance
        for point, expected in zip(points, expected_points, strict=True)
    ):
        return (), (), ()
    try:
        transform = cv2.getPerspectiveTransform(
            np.asarray(marker_centers(), dtype=np.float32),
            np.asarray(points, dtype=np.float32),
        )
        page_corners = cv2.perspectiveTransform(
            np.asarray(
                [
                    [
                        [0, 0],
                        [CANONICAL_WIDTH, 0],
                        [CANONICAL_WIDTH, CANONICAL_HEIGHT],
                        [0, CANONICAL_HEIGHT],
                    ]
                ],
                dtype=np.float32,
            ),
            transform,
        )[0]
    except cv2.error:
        return (), (), ()
    edge_tolerance = min(width, height) * 0.04
    edge_distances = (
        (page_corners[0][0], page_corners[0][1]),
        (width - page_corners[1][0], page_corners[1][1]),
        (width - page_corners[2][0], height - page_corners[2][1]),
        (page_corners[3][0], height - page_corners[3][1]),
    )
    if any(
        abs(float(left)) > edge_tolerance or abs(float(top)) > edge_tolerance
        for left, top in edge_distances
    ):
        return (), (), ()
    return points, sizes, centroid_offsets


def _marker_candidates(
    binary: GrayImage,
    image: GrayImage,
    minimum_side: float,
    maximum_side: float,
    *,
    require_corner: bool = True,
    use_bounds_center: bool = False,
) -> list[tuple[float, float, float, float, float, float]]:
    count, _labels, stats, centroids = cv2.connectedComponentsWithStats(binary)
    height, width = image.shape
    candidates: list[tuple[float, float, float, float, float, float]] = []
    for index in range(1, count):
        component_width = float(stats[index, cv2.CC_STAT_WIDTH])
        component_height = float(stats[index, cv2.CC_STAT_HEIGHT])
        area = float(stats[index, cv2.CC_STAT_AREA])
        if not (
            minimum_side <= component_width <= maximum_side
            and minimum_side <= component_height <= maximum_side
        ):
            continue
        aspect = component_width / component_height
        fill = area / (component_width * component_height)
        if not 0.72 <= aspect <= 1.38 or fill < 0.68:
            continue
        centroid_x, centroid_y = (float(value) for value in centroids[index])
        left = float(stats[index, cv2.CC_STAT_LEFT])
        top = float(stats[index, cv2.CC_STAT_TOP])
        bounds_x = left + (component_width - 1) / 2
        bounds_y = top + (component_height - 1) / 2
        x = bounds_x if use_bounds_center else centroid_x
        y = bounds_y if use_bounds_center else centroid_y
        if require_corner and not (x < width * 0.22 or x > width * 0.78):
            continue
        if require_corner and not (y < height * 0.22 or y > height * 0.78):
            continue
        offset_x = (x - bounds_x) / component_width
        offset_y = (y - bounds_y) / component_height
        candidates.append(
            (
                x,
                y,
                (component_width + component_height) / 2,
                fill,
                offset_x,
                offset_y,
            )
        )
    return candidates


def _adaptive_marker_candidates(
    image: GrayImage,
    minimum_side: float,
    maximum_side: float,
    width: int,
    height: int,
) -> list[tuple[float, float, float, float, float, float]]:
    window_radius = max(24, round(min(width, height) * _MARKER_ADAPTIVE_WINDOW_FRACTION))
    expected_points = tuple(
        (
            center_x / CANONICAL_WIDTH * width,
            center_y / CANONICAL_HEIGHT * height,
        )
        for center_x, center_y in marker_centers()
    )
    candidates: list[tuple[float, float, float, float, float, float]] = []
    for expected_x, expected_y in expected_points:
        center_x, center_y = round(expected_x), round(expected_y)
        left = max(0, center_x - window_radius)
        top = max(0, center_y - window_radius)
        right = min(width, center_x + window_radius + 1)
        bottom = min(height, center_y + window_radius + 1)
        region = image[top:bottom, left:right]
        if region.size == 0:
            return []
        threshold, binary = cv2.threshold(
            region, 0, 255, cv2.THRESH_BINARY_INV | cv2.THRESH_OTSU
        )
        threshold = max(float(threshold), _MARKER_ADAPTIVE_MIN_THRESHOLD)
        binary = cast(GrayImage, np.where(region <= threshold, 255, 0).astype(np.uint8))
        local = _marker_candidates(
            binary,
            region,
            minimum_side,
            maximum_side,
            require_corner=False,
            use_bounds_center=True,
        )
        local = [
            item
            for item in local
            if item[0] > 1
            and item[1] > 1
            and item[0] < region.shape[1] - 2
            and item[1] < region.shape[0] - 2
        ]
        if not local:
            return []
        choice = min(
            local,
            key=lambda item: (item[0] - (expected_x - left)) ** 2
            + (item[1] - (expected_y - top)) ** 2,
        )
        candidates.append(
            (
                choice[0] + left,
                choice[1] + top,
                choice[2],
                choice[3],
                choice[4],
                choice[5],
            )
        )
    return candidates


def _crop(image: GrayImage, rectangle: tuple[int, int, int, int]) -> GrayImage:
    left, top, right, bottom = rectangle
    return image[top:bottom, left:right]


def _decode_worker(source_path: str, output_directory: str, raw_limits: dict[str, int]) -> None:
    output = Path(output_directory)
    result_path = output / "decode-result.json"
    try:
        limits = DecodeLimits(**raw_limits)
        _apply_resource_limits(limits)
        source = Path(source_path)
        media_type = _sniff_media_type(source)
        pages = (
            _decode_pdf(source, output, limits)
            if media_type == "application/pdf"
            else _decode_image(source, output, limits)
        )
        payload: dict[str, Any] = {
            "status": "ok",
            "media_type": media_type,
            "pages": pages,
        }
    except _WorkerFailure as exc:
        payload = {
            "status": "error",
            "reason_code": exc.reason_code,
            "detail": str(exc),
        }
    except BaseException as exc:
        payload = {
            "status": "error",
            "reason_code": "decode_failed",
            "detail": f"decoder rejected input: {type(exc).__name__}",
        }
    result_path.write_text(json.dumps(payload, sort_keys=True), encoding="utf-8")


def _decode_image(
    source: Path, output: Path, limits: DecodeLimits
) -> list[dict[str, int | str]]:
    Image.MAX_IMAGE_PIXELS = limits.max_pixels_per_page
    pages: list[dict[str, int | str]] = []
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("error", Image.DecompressionBombWarning)
            with Image.open(source) as document:
                frame_count = int(getattr(document, "n_frames", 1))
                _validate_page_count(frame_count, limits.max_pages)
                for page_index in range(frame_count):
                    document.seek(page_index)
                    frame = ImageOps.exif_transpose(document.copy()).convert("L")
                    _validate_dimensions(frame.width, frame.height, limits)
                    pages.append(_save_array(output, page_index, np.asarray(frame, dtype=np.uint8)))
    except (
        UnidentifiedImageError,
        OSError,
        Image.DecompressionBombError,
        Image.DecompressionBombWarning,
    ) as exc:
        raise _WorkerFailure(
            "malformed_image", f"image decoder rejected input: {type(exc).__name__}"
        ) from None
    return pages


def _decode_pdf(
    source: Path, output: Path, limits: DecodeLimits
) -> list[dict[str, int | str]]:
    if b"/Encrypt" in source.read_bytes():
        raise _WorkerFailure("encrypted_pdf", "encrypted PDF inputs are not supported")
    pdfium = importlib.import_module("pypdfium2")
    try:
        document = pdfium.PdfDocument(str(source))
        frame_count = len(document)
        _validate_page_count(frame_count, limits.max_pages)
        pages: list[dict[str, int | str]] = []
        scale = limits.pdf_dpi / 72
        for page_index in range(frame_count):
            page = document[page_index]
            width_points, height_points = page.get_size()
            width = round(float(width_points) * scale)
            height = round(float(height_points) * scale)
            _validate_dimensions(width, height, limits)
            bitmap = page.render(scale=scale, grayscale=True)
            frame = bitmap.to_pil().convert("L")
            _validate_dimensions(frame.width, frame.height, limits)
            pages.append(_save_array(output, page_index, np.asarray(frame, dtype=np.uint8)))
        return pages
    except _WorkerFailure:
        raise
    except BaseException as exc:
        raise _WorkerFailure(
            "malformed_pdf", f"PDF decoder rejected input: {type(exc).__name__}"
        ) from None


def _save_array(
    output: Path, page_index: int, value: NDArray[np.uint8]
) -> dict[str, int | str]:
    filename = f"page-{page_index:04d}.npy"
    path = output / filename
    with path.open("wb") as handle:
        np.save(handle, value, allow_pickle=False)
        handle.flush()
        os.fsync(handle.fileno())
    return {
        "page_index": page_index,
        "filename": filename,
        "width": int(value.shape[1]),
        "height": int(value.shape[0]),
    }


def _sniff_media_type(source: Path) -> str:
    try:
        prefix = source.read_bytes()[:16]
    except OSError:
        raise _WorkerFailure("source_unreadable", "source file cannot be read") from None
    if prefix.startswith(b"%PDF-"):
        return "application/pdf"
    if prefix.startswith(b"\x89PNG\r\n\x1a\n"):
        return "image/png"
    if prefix.startswith(b"\xff\xd8\xff"):
        return "image/jpeg"
    if prefix.startswith((b"II*\x00", b"MM\x00*")):
        return "image/tiff"
    raise _WorkerFailure("unsupported_media_type", "input signature is not an allowed format")


def _validate_page_count(page_count: int, maximum: int) -> None:
    if page_count < 1:
        raise _WorkerFailure("empty_document", "input contains no pages")
    if page_count > maximum:
        raise _WorkerFailure("page_limit_exceeded", "input exceeds the configured page limit")


def _validate_dimensions(width: int, height: int, limits: DecodeLimits) -> None:
    if width < 1 or height < 1:
        raise _WorkerFailure("invalid_dimensions", "decoded page dimensions are invalid")
    if width * height > limits.max_pixels_per_page:
        raise _WorkerFailure("pixel_limit_exceeded", "page exceeds the configured pixel limit")


def _apply_resource_limits(limits: DecodeLimits) -> None:
    if platform.system() not in {"Linux", "Darwin"}:
        return
    try:
        resource = importlib.import_module("resource")
        memory_bytes = limits.memory_mb * 1024 * 1024
        resource.setrlimit(resource.RLIMIT_AS, (memory_bytes, memory_bytes))
        cpu_seconds = max(1, math.ceil(limits.timeout_seconds))
        resource.setrlimit(resource.RLIMIT_CPU, (cpu_seconds, cpu_seconds + 1))
    except (AttributeError, OSError, ValueError):
        return
