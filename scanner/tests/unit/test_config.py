from __future__ import annotations

from pathlib import Path

import pytest

from order_scanner.config import (
    ConfigError,
    _validate_secret_file_permissions,
    bundled_migrations_path,
    load_config,
)


def _write_config(path: Path, *, database: str = "./var/state.sqlite3") -> None:
    path.write_text(
        f"""
[paths]
database = {database!r}
spool = './var/spool'
artifacts = './var/artifacts'
migrations = './migrations'

[callback]
url = 'https://callback.example.test/result'
token_env = 'CALLBACK_TOKEN'

[limits]
document_code_pattern = '\\d{{6}}'
room_code_pattern = '[A-Za-z0-9]{{1,4}}'

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


def test_loads_valid_config_and_redacts_secret(tmp_path: Path) -> None:
    config_path = tmp_path / "config.toml"
    _write_config(config_path)

    config = load_config(config_path, environment={"CALLBACK_TOKEN": "very-secret"})

    assert config.paths.database == (tmp_path / "var/state.sqlite3").resolve()
    assert config.paths.migrations == (tmp_path / "migrations").resolve()
    assert config.limits.room_code_max_length == 4
    assert config.limits.quantity_max == 999
    assert config.callback.token.reveal() == "very-secret"
    assert "very-secret" not in repr(config.callback.token)
    assert len(config.versions.bundle_fingerprint()) == 64
    assert config.paths.inbox is None
    assert config.scanner.allowed_extensions == (".png", ".jpg", ".jpeg", ".tif", ".tiff", ".pdf")
    assert config.scanner.pdf_dpi == 150


def test_loads_scanner_inbox_and_rejects_unsupported_extensions(tmp_path: Path) -> None:
    config_path = tmp_path / "config.toml"
    _write_config(config_path)
    config_path.write_text(
        config_path.read_text(encoding="utf-8").replace(
            "spool = './var/spool'",
            "spool = './var/spool'\ninbox = './scanner-inbox'",
        )
        + "\n[scanner]\nallowed_extensions = ['.bmp']\n",
        encoding="utf-8",
    )

    with pytest.raises(ConfigError, match="unsupported format"):
        load_config(config_path, environment={"CALLBACK_TOKEN": "secret"})


def test_uses_bundled_migrations_when_path_is_omitted(tmp_path: Path) -> None:
    config_path = tmp_path / "config.toml"
    _write_config(config_path)
    config_path.write_text(
        config_path.read_text(encoding="utf-8").replace("migrations = './migrations'\n", ""),
        encoding="utf-8",
    )

    config = load_config(config_path, environment={"CALLBACK_TOKEN": "secret"})

    assert config.paths.migrations == bundled_migrations_path()
    assert config.paths.migrations.is_dir()


def test_rejects_network_path_before_secret_resolution(tmp_path: Path) -> None:
    config_path = tmp_path / "config.toml"
    _write_config(config_path, database="//server/share/state.sqlite3")

    with pytest.raises(ConfigError, match="local filesystem path"):
        load_config(config_path, environment={})


def test_rejects_missing_secret_without_mutating_directories(tmp_path: Path) -> None:
    config_path = tmp_path / "config.toml"
    _write_config(config_path)

    with pytest.raises(ConfigError, match="environment variable CALLBACK_TOKEN"):
        load_config(config_path, environment={})
    assert not (tmp_path / "var").exists()


def test_rejects_invalid_room_pattern(tmp_path: Path) -> None:
    config_path = tmp_path / "config.toml"
    _write_config(config_path)
    config_path.write_text(
        config_path.read_text(encoding="utf-8").replace(
            "room_code_pattern = '[A-Za-z0-9]{1,4}'",
            "room_code_pattern = '[A-Z-]{1,4}'",
        ),
        encoding="utf-8",
    )

    with pytest.raises(ConfigError):
        load_config(config_path, environment={"CALLBACK_TOKEN": "secret"})


@pytest.mark.parametrize(
    "url",
    [
        "https://callback.example.test/result?token=secret",
        "https://callback.example.test/result#secret",
        "https://callback.example.test:invalid/result",
        "https://[bad",
    ],
)
def test_rejects_callback_url_credentials_in_query_or_fragment(
    tmp_path: Path, url: str
) -> None:
    config_path = tmp_path / "config.toml"
    _write_config(config_path)
    config_path.write_text(
        config_path.read_text(encoding="utf-8").replace(
            "https://callback.example.test/result", url
        ),
        encoding="utf-8",
    )

    with pytest.raises(ConfigError, match="HTTPS URL"):
        load_config(config_path, environment={"CALLBACK_TOKEN": "secret"})


@pytest.mark.parametrize("url", [
    "http://localhost:3000/webhooks/order-scanner",
    "http://127.0.0.1:3000/webhooks/order-scanner",
    "http://[::1]:3000/webhooks/order-scanner",
])
def test_allows_loopback_http_callback_for_development(tmp_path: Path, url: str) -> None:
    config_path = tmp_path / "config.toml"
    _write_config(config_path)
    config_path.write_text(
        config_path.read_text(encoding="utf-8").replace(
            "https://callback.example.test/result", url
        ),
        encoding="utf-8",
    )

    config = load_config(config_path, environment={"CALLBACK_TOKEN": "secret"})

    assert config.callback.url == url


@pytest.mark.parametrize("url", [
    "http://callback.example.test/result",
    "http://localhost./result",
    "http://127.1/result",
    "http://2130706433/result",
    "http://0x7f000001/result",
    "http://[::ffff:127.0.0.1]/result",
    "http://[fe80::1%25lo0]/result",
])
def test_rejects_non_exact_loopback_http_callback(tmp_path: Path, url: str) -> None:
    config_path = tmp_path / "config.toml"
    _write_config(config_path)
    config_path.write_text(
        config_path.read_text(encoding="utf-8").replace(
            "https://callback.example.test/result", url
        ),
        encoding="utf-8",
    )

    with pytest.raises(ConfigError, match="HTTPS URL"):
        load_config(config_path, environment={"CALLBACK_TOKEN": "secret"})


def test_windows_secret_files_fail_closed() -> None:
    with pytest.raises(ConfigError, match="Windows.*environment variable"):
        _validate_secret_file_permissions(0o600, "token_file", "nt")


def test_enabled_api_requires_artifact_credential_and_tls_boundary(tmp_path: Path) -> None:
    config_path = tmp_path / "config.toml"
    _write_config(config_path)
    config_path.write_text(
        config_path.read_text(encoding="utf-8")
        + "\n[api]\nenabled = true\ntls_terminated_upstream = true\n",
        encoding="utf-8",
    )
    with pytest.raises(ConfigError, match="artifact_token"):
        load_config(config_path, environment={"CALLBACK_TOKEN": "secret"})

    config_path.write_text(
        config_path.read_text(encoding="utf-8").replace(
            "token_env = 'CALLBACK_TOKEN'",
            "token_env = 'CALLBACK_TOKEN'\nartifact_token_env = 'ARTIFACT_TOKEN'",
        ),
        encoding="utf-8",
    )
    config = load_config(
        config_path,
        environment={"CALLBACK_TOKEN": "secret", "ARTIFACT_TOKEN": "artifact"},
    )
    assert config.api.enabled


def test_rejects_equal_callback_and_artifact_tokens(tmp_path: Path) -> None:
    config_path = tmp_path / "config.toml"
    _write_config(config_path)
    config_path.write_text(
        config_path.read_text(encoding="utf-8").replace(
            "token_env = 'CALLBACK_TOKEN'",
            "token_env = 'CALLBACK_TOKEN'\nartifact_token_env = 'ARTIFACT_TOKEN'",
        ),
        encoding="utf-8",
    )

    with pytest.raises(ConfigError, match="different"):
        load_config(
            config_path,
            environment={"CALLBACK_TOKEN": "same-secret", "ARTIFACT_TOKEN": "same-secret"},
        )


def test_rejects_reversed_disk_watermarks(tmp_path: Path) -> None:
    config_path = tmp_path / "config.toml"
    _write_config(config_path)
    config_path.write_text(
        config_path.read_text(encoding="utf-8")
        + "\n[service]\ndisk_high_watermark_percent = 80\ndisk_low_watermark_percent = 90\n",
        encoding="utf-8",
    )
    with pytest.raises(ConfigError, match="disk watermarks"):
        load_config(config_path, environment={"CALLBACK_TOKEN": "secret"})


def test_loads_paddleocr_recognition_settings(tmp_path: Path) -> None:
    config_path = tmp_path / "config.toml"
    model_dir = tmp_path / "model"
    model_dir.mkdir()
    catalogue_path = tmp_path / "catalogue.json"
    catalogue_path.write_text("{}", encoding="utf-8")
    _write_config(config_path)
    config_path.write_text(
        config_path.read_text(encoding="utf-8")
        .replace("model = 'none'", "model = 'paddleocr-baseline'")
        .replace("thresholds = 'none'", "thresholds = 'review-only-v1'")
        + f"""
[recognition]
enabled = true
model_name = 'latin_PP-OCRv5_mobile_rec'
model_dir = '{model_dir.as_posix()}'
catalogue_path = '{catalogue_path.as_posix()}'
cpu_threads = 6
minimum_item_score = 0.9
minimum_item_margin = 0.12
""",
        encoding="utf-8",
    )

    config = load_config(config_path, environment={"CALLBACK_TOKEN": "secret"})

    assert config.recognition.enabled
    assert not config.recognition.auto_accept_enabled
    assert config.recognition.model_name == "latin_PP-OCRv5_mobile_rec"
    assert config.recognition.model_dir == model_dir
    assert config.recognition.catalogue_path == catalogue_path
    assert config.recognition.cpu_threads == 6
    assert config.recognition.minimum_item_score == 0.9
    assert config.recognition.minimum_item_margin == 0.12
    assert config.recognition.catalogue_sha256 is not None


def test_recognition_settings_change_bundle_fingerprint(tmp_path: Path) -> None:
    config_path = tmp_path / "config.toml"
    _write_config(config_path)
    first = load_config(config_path, environment={"CALLBACK_TOKEN": "secret"})
    config_path.write_text(
        config_path.read_text(encoding="utf-8")
        + "\n[recognition]\nminimum_item_score = 0.91\n",
        encoding="utf-8",
    )
    second = load_config(config_path, environment={"CALLBACK_TOKEN": "secret"})

    assert first.bundle_fingerprint() != second.bundle_fingerprint()


def test_rejects_recognition_threshold_outside_unit_interval(tmp_path: Path) -> None:
    config_path = tmp_path / "config.toml"
    _write_config(config_path)
    config_path.write_text(
        config_path.read_text(encoding="utf-8")
        + "\n[recognition]\nminimum_item_score = 1.1\n",
        encoding="utf-8",
    )

    with pytest.raises(ConfigError, match="between 0 and 1"):
        load_config(config_path, environment={"CALLBACK_TOKEN": "secret"})


def test_enabled_recognition_rejects_placeholder_provenance(tmp_path: Path) -> None:
    config_path = tmp_path / "config.toml"
    _write_config(config_path)
    config_path.write_text(
        config_path.read_text(encoding="utf-8") + "\n[recognition]\nenabled = true\n",
        encoding="utf-8",
    )

    with pytest.raises(ConfigError, match="versions.model"):
        load_config(config_path, environment={"CALLBACK_TOKEN": "secret"})


def test_recognition_auto_accept_requires_catalogue(tmp_path: Path) -> None:
    config_path = tmp_path / "config.toml"
    _write_config(config_path)
    config_path.write_text(
        config_path.read_text(encoding="utf-8")
        .replace("model = 'none'", "model = 'paddleocr-baseline'")
        .replace("thresholds = 'none'", "thresholds = 'calibrated-v1'")
        + "\n[recognition]\nenabled = true\nauto_accept_enabled = true\n",
        encoding="utf-8",
    )

    with pytest.raises(ConfigError, match="catalogue_path"):
        load_config(config_path, environment={"CALLBACK_TOKEN": "secret"})
