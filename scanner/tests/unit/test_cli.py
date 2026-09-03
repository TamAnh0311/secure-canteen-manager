from __future__ import annotations

from datetime import UTC, datetime
from pathlib import Path

import pytest

from order_scanner.cli import _build_recognition_engine, main
from order_scanner.config import LimitConfig, RecognitionConfig
from order_scanner.contracts import Catalogue, CatalogueItem


def test_build_recognition_engine_is_disabled_by_default() -> None:
    assert _build_recognition_engine(RecognitionConfig(), LimitConfig()) is None


def test_build_recognition_engine_wires_paddleocr_and_catalogue(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    created: dict[str, object] = {}

    class Backend:
        def __init__(self, **kwargs: object) -> None:
            created.update(kwargs)

    monkeypatch.setattr("order_scanner.cli.PaddleOCRBackend", Backend)
    catalogue = Catalogue(
        "catalogue-1",
        (CatalogueItem("001", "Bánh mì"),),
        datetime(2026, 8, 5, tzinfo=UTC),
    )
    monkeypatch.setattr("order_scanner.cli.load_catalogue", lambda _path: catalogue)

    engine = _build_recognition_engine(
        RecognitionConfig(enabled=True, catalogue_path=Path("catalogue.json")),
        LimitConfig(),
    )

    assert engine is not None
    assert created["model_name"] == "latin_PP-OCRv5_mobile_rec"
    assert created["cpu_threads"] == 4
    assert engine.catalogue is not None
    assert not engine.policy.auto_accept_enabled


def test_status_does_not_create_missing_database(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    config_path = tmp_path / "config.toml"
    config_path.write_text(
        f"""
[paths]
database = '{(tmp_path / 'var' / 'state.sqlite3').as_posix()}'
spool = '{(tmp_path / 'var' / 'spool').as_posix()}'
artifacts = '{(tmp_path / 'var' / 'artifacts').as_posix()}'
migrations = '{(Path(__file__).parents[2] / 'migrations').as_posix()}'

[callback]
url = 'https://callback.example.test/result'
token_env = 'CALLBACK_TOKEN'

[versions]
config_schema = '1'
callback_schema = '1.0-draft'
template = 'ticket-v4'
preprocessing = 'none'
model = 'none'
thresholds = 'none'
catalogue = 'catalogue-1'
""",
        encoding="utf-8",
    )
    monkeypatch.setenv("CALLBACK_TOKEN", "secret")

    assert main(["status", "--config", str(config_path)]) == 0
    assert capsys.readouterr().out.strip() == "{}"
    assert not (tmp_path / "var").exists()
