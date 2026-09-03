"""Catalogue loading and closed-vocabulary item ranking."""

from __future__ import annotations

import json
import re
import unicodedata
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from order_scanner.contracts import Candidate, Catalogue, CatalogueItem, ContractError


class CatalogueError(ContractError):
    """A catalogue cannot be loaded or contains an unsafe ambiguity."""


@dataclass(frozen=True, slots=True)
class RankingPolicy:
    minimum_score: float = 0.82
    minimum_margin: float = 0.08
    candidate_limit: int = 5

    def __post_init__(self) -> None:
        if not 0.0 <= self.minimum_score <= 1.0:
            raise CatalogueError("minimum_score must be between 0 and 1")
        if not 0.0 <= self.minimum_margin <= 1.0:
            raise CatalogueError("minimum_margin must be between 0 and 1")
        if self.candidate_limit < 1:
            raise CatalogueError("candidate_limit must be positive")


@dataclass(frozen=True, slots=True)
class CatalogueMatch:
    item_id: str
    canonical_name: str
    score: float
    margin: float
    matched_alias: str
    accepted: bool


def normalize_text(value: str) -> str:
    """Apply the conservative normalization shared by recognition and ranking."""
    normalized = unicodedata.normalize("NFC", value).casefold()
    normalized = "".join(
        " " if unicodedata.category(character).startswith("P") else character
        for character in normalized
    )
    return " ".join(normalized.split())


def accent_stripped(value: str) -> str:
    decomposed = unicodedata.normalize("NFD", value)
    stripped = "".join(
        character for character in decomposed if unicodedata.category(character) != "Mn"
    )
    return stripped.replace("đ", "d").replace("Đ", "D")


class CatalogueIndex:
    """Immutable lookup index for canonical names and explicitly approved aliases."""

    def __init__(self, catalogue: Catalogue) -> None:
        self.catalogue = catalogue
        self._entries: dict[str, tuple[CatalogueItem, str]] = {}
        for item in catalogue.items:
            values = (item.canonical_name, *item.aliases)
            for value in values:
                key = normalize_text(value)
                if not key:
                    raise CatalogueError(f"catalogue entry for {item.item_id} is empty")
                previous = self._entries.get(key)
                if previous is not None and previous[0].item_id != item.item_id:
                    raise CatalogueError(
                        "catalogue alias collision between "
                        f"{previous[0].item_id} and {item.item_id}"
                    )
                self._entries[key] = (item, value)

    def exact(self, value: str) -> CatalogueItem | None:
        entry = self._entries.get(normalize_text(value))
        return entry[0] if entry else None

    def rank(
        self,
        raw_text: str,
        hypotheses: Sequence[tuple[str, float]] = (),
        policy: RankingPolicy | None = None,
    ) -> tuple[CatalogueMatch, ...]:
        ranking_policy = policy or RankingPolicy()
        if not raw_text.strip() and not hypotheses:
            return ()
        observations = list(hypotheses) or [(raw_text, 1.0)]
        scored: dict[str, tuple[CatalogueItem, str, float]] = {}
        for hypothesis, model_confidence in observations:
            if not 0.0 <= model_confidence <= 1.0:
                raise CatalogueError("hypothesis confidence must be between 0 and 1")
            normalized_hypothesis = normalize_text(hypothesis)
            if not normalized_hypothesis:
                continue
            for key, (item, matched_alias) in self._entries.items():
                score = _match_score(normalized_hypothesis, key) * model_confidence
                current = scored.get(item.item_id)
                if current is None or score > current[2]:
                    scored[item.item_id] = (item, matched_alias, score)
        ordered = sorted(scored.values(), key=lambda value: (-value[2], value[0].item_id))
        matches: list[CatalogueMatch] = []
        for index, (item, alias, score) in enumerate(ordered[: ranking_policy.candidate_limit]):
            runner_up = ordered[index + 1][2] if index + 1 < len(ordered) else 0.0
            margin = score - runner_up
            matches.append(
                CatalogueMatch(
                    item_id=item.item_id,
                    canonical_name=item.canonical_name,
                    score=score,
                    margin=margin,
                    matched_alias=alias,
                    accepted=(
                        index == 0
                        and score >= ranking_policy.minimum_score
                        and margin >= ranking_policy.minimum_margin
                    ),
                )
            )
        return tuple(matches)

    def candidates(self, matches: Sequence[CatalogueMatch]) -> tuple[Candidate, ...]:
        return tuple(
            Candidate(match.canonical_name, match.score, match.item_id) for match in matches
        )


def load_catalogue(path: str | Path) -> Catalogue:
    source = Path(path)
    try:
        payload = json.loads(source.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError) as exc:
        raise CatalogueError(f"cannot read catalogue: {type(exc).__name__}") from None
    if not isinstance(payload, dict):
        raise CatalogueError("catalogue document must be an object")
    try:
        version = _string(payload, "version")
        raw_items = payload["items"]
        created_at = datetime.fromisoformat(_string(payload, "created_at").replace("Z", "+00:00"))
    except (KeyError, TypeError, ValueError) as exc:
        raise CatalogueError(f"invalid catalogue document: {exc}") from None
    if not isinstance(raw_items, list):
        raise CatalogueError("catalogue items must be a list")
    items: list[CatalogueItem] = []
    for raw_item in raw_items:
        if not isinstance(raw_item, dict):
            raise CatalogueError("catalogue item must be an object")
        aliases = raw_item.get("aliases", ())
        if not isinstance(aliases, list) or not all(isinstance(alias, str) for alias in aliases):
            raise CatalogueError("catalogue aliases must be a list of strings")
        items.append(
            CatalogueItem(
                item_id=_string(raw_item, "item_id"),
                canonical_name=_string(raw_item, "canonical_name"),
                aliases=tuple(aliases),
            )
        )
        if not re.fullmatch(r"[0-9]{3}", items[-1].item_id):
            raise CatalogueError("catalogue item_id must be a three-digit manager menu code")
    try:
        catalogue = Catalogue(version, tuple(items), created_at)
        _require_utc(created_at)
        CatalogueIndex(catalogue)
    except (TypeError, ValueError, CatalogueError) as exc:
        raise CatalogueError(str(exc)) from None
    return catalogue


def _match_score(left: str, right: str) -> float:
    if left == right:
        return 1.0
    full = _similarity(left, right)
    accent = _similarity(accent_stripped(left), accent_stripped(right))
    return max(full, accent * 0.97)


def _similarity(left: str, right: str) -> float:
    width = max(len(left), len(right))
    return 1.0 if width == 0 else 1.0 - _levenshtein(left, right) / width


def _levenshtein(left: str, right: str) -> int:
    previous = list(range(len(right) + 1))
    for left_index, left_character in enumerate(left, start=1):
        current = [left_index]
        for right_index, right_character in enumerate(right, start=1):
            current.append(
                min(
                    current[-1] + 1,
                    previous[right_index] + 1,
                    previous[right_index - 1] + (left_character != right_character),
                )
            )
        previous = current
    return previous[-1]


def _string(value: dict[str, Any], key: str) -> str:
    result = value.get(key)
    if not isinstance(result, str) or not result.strip():
        raise CatalogueError(f"catalogue {key} must be a non-empty string")
    return result


def _require_utc(value: datetime) -> None:
    if value.tzinfo is None or value.utcoffset() != UTC.utcoffset(value):
        raise CatalogueError("catalogue created_at must be timezone-aware UTC")
