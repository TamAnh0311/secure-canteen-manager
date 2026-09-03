from __future__ import annotations

from datetime import UTC, datetime
from pathlib import Path

import pytest

from order_scanner.catalogue import (
    CatalogueError,
    CatalogueIndex,
    RankingPolicy,
    accent_stripped,
    load_catalogue,
    normalize_text,
)
from order_scanner.contracts import Catalogue, CatalogueItem


def _catalogue(*items: CatalogueItem) -> CatalogueIndex:
    return CatalogueIndex(Catalogue("catalogue-1", items, datetime(2026, 8, 4, tzinfo=UTC)))


def test_normalization_is_unicode_aware_and_conservative() -> None:
    assert normalize_text("  BÁNH—MÌ,  ĐẶC BIỆT ") == "bánh mì đặc biệt"
    assert accent_stripped("Đậu") == "Dau"


def test_approved_alias_resolves_to_canonical_item() -> None:
    index = _catalogue(CatalogueItem("item-1", "Bánh mì", ("BM",)))

    matches = index.rank("BM", (("BM", 0.99),))

    assert matches[0].accepted is True
    assert matches[0].item_id == "item-1"
    assert matches[0].canonical_name == "Bánh mì"
    assert index.candidates(matches)[0].value == "Bánh mì"


def test_hard_pair_requires_runner_up_margin() -> None:
    index = _catalogue(
        CatalogueItem("item-1", "Bún bò"),
        CatalogueItem("item-2", "Bún bơ"),
    )

    matches = index.rank(
        "Bún bo",
        (("Bún bo", 1.0),),
        RankingPolicy(minimum_score=0.7, minimum_margin=0.2),
    )

    assert matches[0].accepted is False
    assert {match.item_id for match in matches[:2]} == {"item-1", "item-2"}


def test_only_top_ranked_catalogue_match_can_be_accepted() -> None:
    index = _catalogue(
        CatalogueItem("item-1", "abc"),
        CatalogueItem("item-2", "abd"),
        CatalogueItem("item-3", "xyz"),
    )

    matches = index.rank(
        "abc", (("abc", 1.0),), RankingPolicy(minimum_score=0.5, minimum_margin=0.2)
    )

    assert matches[0].accepted is True
    assert all(not match.accepted for match in matches[1:])


def test_alias_collision_between_items_is_rejected() -> None:
    with pytest.raises(CatalogueError, match="collision"):
        _catalogue(
            CatalogueItem("item-1", "Cơm", ("COM",)),
            CatalogueItem("item-2", "Cháo", ("com",)),
        )


def test_loaded_catalogue_requires_manager_menu_codes(tmp_path: Path) -> None:
    path = tmp_path / "catalogue.json"
    path.write_text(
        '{"version":"v1","created_at":"2026-08-04T00:00:00Z",'
        '"items":[{"item_id":"manager-uuid","canonical_name":"Rice","aliases":[]}]}',
        encoding="utf-8",
    )

    with pytest.raises(CatalogueError, match="three-digit manager menu code"):
        load_catalogue(path)
