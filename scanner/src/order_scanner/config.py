from __future__ import annotations

import ctypes
import hashlib
import os
import platform
import re
import subprocess
import tomllib
from collections.abc import Mapping
from dataclasses import dataclass
from pathlib import Path
from typing import Any
from urllib.parse import urlsplit
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError


class ConfigError(ValueError):
    """Configuration is invalid or unsafe to use."""


class SecretValue:
    """Secret wrapper whose repr and string conversion never reveal the value."""

    __slots__ = ("_value",)

    def __init__(self, value: str) -> None:
        if not value:
            raise ConfigError("configured secret is empty")
        self._value = value

    def reveal(self) -> str:
        return self._value

    def __repr__(self) -> str:
        return "SecretValue('[redacted]')"

    __str__ = __repr__


@dataclass(frozen=True, slots=True)
class PathConfig:
    database: Path
    spool: Path
    artifacts: Path
    migrations: Path
    inbox: Path | None


@dataclass(frozen=True, slots=True)
class ServiceConfig:
    workers: int = 1
    sqlite_busy_timeout_ms: int = 5_000
    lease_seconds: int = 300
    recovery_interval_seconds: int = 30
    callback_poll_interval_seconds: float = 1.0
    max_job_attempts: int = 3
    disk_high_watermark_percent: int = 90
    disk_low_watermark_percent: int = 80


@dataclass(frozen=True, slots=True)
class LimitConfig:
    max_source_bytes: int = 50 * 1024 * 1024
    max_pages: int = 100
    max_pixels_per_page: int = 50_000_000
    room_code_max_length: int = 4
    quantity_max: int = 999
    callback_payload_max_bytes: int = 512 * 1024
    candidate_limit: int = 5
    document_code_pattern: str = r"\d{6}"
    room_code_pattern: str = r"[A-Za-z0-9]{1,4}"


@dataclass(frozen=True, slots=True)
class ScannerConfig:
    allowed_extensions: tuple[str, ...] = (".png", ".jpg", ".jpeg", ".tif", ".tiff", ".pdf")
    staging_suffixes: tuple[str, ...] = (".part", ".partial", ".tmp")
    ready_suffix: str | None = None
    stable_observations: int = 3
    stable_seconds: int = 10
    minimum_age_seconds: int = 10
    poll_interval_seconds: int = 3
    decode_timeout_seconds: int = 30
    decode_memory_mb: int = 512
    pdf_dpi: int = 150
    service_date_timezone: str = "Asia/Saigon"
    service_date_offset_days: int = 1


@dataclass(frozen=True, slots=True)
class RecognitionConfig:
    enabled: bool = False
    auto_accept_enabled: bool = False
    model_name: str = "latin_PP-OCRv5_mobile_rec"
    model_dir: Path | None = None
    catalogue_path: Path | None = None
    cpu_threads: int = 4
    minimum_item_score: float = 0.82
    minimum_item_margin: float = 0.08
    catalogue_sha256: str | None = None


@dataclass(frozen=True, slots=True)
class CallbackConfig:
    url: str
    token: SecretValue
    artifact_token: SecretValue | None
    timeout_seconds: float = 10.0
    retry_base_seconds: float = 2.0
    retry_max_seconds: float = 300.0


@dataclass(frozen=True, slots=True)
class ApiConfig:
    enabled: bool = False
    bind_host: str = "127.0.0.1"
    port: int = 8443
    public_base_url: str = "https://127.0.0.1:8443"
    tls_cert_file: Path | None = None
    tls_key_file: Path | None = None
    tls_terminated_upstream: bool = False


@dataclass(frozen=True, slots=True)
class VersionConfig:
    config_schema: str
    callback_schema: str
    template: str
    preprocessing: str
    model: str
    thresholds: str
    catalogue: str

    def bundle_fingerprint(self) -> str:
        values = (
            self.config_schema,
            self.callback_schema,
            self.template,
            self.preprocessing,
            self.model,
            self.thresholds,
            self.catalogue,
        )
        return hashlib.sha256("\x1f".join(values).encode("utf-8")).hexdigest()


@dataclass(frozen=True, slots=True)
class RetentionConfig:
    artifact_days: int = 30
    audit_days: int = 365


@dataclass(frozen=True, slots=True)
class AppConfig:
    paths: PathConfig
    service: ServiceConfig
    limits: LimitConfig
    callback: CallbackConfig
    api: ApiConfig
    versions: VersionConfig
    retention: RetentionConfig
    scanner: ScannerConfig
    recognition: RecognitionConfig

    def bundle_fingerprint(self) -> str:
        """Bind effective recognition settings to the durable pipeline identity."""
        values = (
            self.versions.bundle_fingerprint(),
            str(self.recognition.enabled),
            str(self.recognition.auto_accept_enabled),
            self.recognition.model_name,
            str(self.recognition.model_dir) if self.recognition.model_dir else "",
            str(self.recognition.cpu_threads),
            str(self.recognition.minimum_item_score),
            str(self.recognition.minimum_item_margin),
            self.recognition.catalogue_sha256 or "",
            str(self.limits.room_code_max_length),
            str(self.limits.quantity_max),
            str(self.limits.candidate_limit),
        )
        return hashlib.sha256("\x1f".join(values).encode("utf-8")).hexdigest()


def bundled_migrations_path() -> Path:
    """Return the SQL migrations shipped inside the installed package."""
    packaged = Path(__file__).with_name("migrations")
    if packaged.is_dir():
        return packaged
    source_checkout = Path(__file__).resolve().parents[2] / "migrations"
    if source_checkout.is_dir():
        return source_checkout
    return packaged


_NETWORK_FILESYSTEMS = {
    "9p",
    "afpfs",
    "cifs",
    "davfs",
    "fuse.sshfs",
    "nfs",
    "nfs4",
    "remote",
    "smbfs",
    "sshfs",
    "webdav",
}


def load_config(
    config_path: str | Path,
    *,
    environment: Mapping[str, str] | None = None,
) -> AppConfig:
    path = Path(config_path).expanduser().resolve()
    try:
        with path.open("rb") as handle:
            raw = tomllib.load(handle)
    except (OSError, tomllib.TOMLDecodeError) as exc:
        raise ConfigError(f"cannot read configuration: {type(exc).__name__}") from None

    _reject_unknown(
        raw,
        {
            "paths",
            "service",
            "limits",
            "callback",
            "api",
            "versions",
            "retention",
            "scanner",
            "recognition",
        },
        "root",
    )
    base = path.parent
    paths_table = _table(raw, "paths")
    _reject_unknown(
        paths_table, {"database", "spool", "artifacts", "migrations", "inbox"}, "paths"
    )
    paths = PathConfig(
        database=_local_path(paths_table, "database", base, is_file=True),
        spool=_local_path(paths_table, "spool", base),
        artifacts=_local_path(paths_table, "artifacts", base),
        migrations=(
            _local_path(paths_table, "migrations", base)
            if "migrations" in paths_table
            else bundled_migrations_path()
        ),
        inbox=(
            _share_path(paths_table, "inbox", base) if "inbox" in paths_table else None
        ),
    )
    _validate_non_overlapping_paths(paths)

    service_table = _table(raw, "service", required=False)
    _reject_unknown(
        service_table,
        {
            "workers",
            "sqlite_busy_timeout_ms",
            "lease_seconds",
            "recovery_interval_seconds",
            "callback_poll_interval_seconds",
            "max_job_attempts",
            "disk_high_watermark_percent",
            "disk_low_watermark_percent",
        },
        "service",
    )
    service = ServiceConfig(
        workers=_positive_int(service_table, "workers", 1),
        sqlite_busy_timeout_ms=_positive_int(service_table, "sqlite_busy_timeout_ms", 5_000),
        lease_seconds=_positive_int(service_table, "lease_seconds", 300),
        recovery_interval_seconds=_positive_int(
            service_table, "recovery_interval_seconds", 30
        ),
        callback_poll_interval_seconds=_positive_float(
            service_table, "callback_poll_interval_seconds", 1.0
        ),
        max_job_attempts=_positive_int(service_table, "max_job_attempts", 3),
        disk_high_watermark_percent=_positive_int(
            service_table, "disk_high_watermark_percent", 90
        ),
        disk_low_watermark_percent=_positive_int(
            service_table, "disk_low_watermark_percent", 80
        ),
    )
    if not 1 <= service.disk_low_watermark_percent < service.disk_high_watermark_percent < 100:
        raise ConfigError(
            "service disk watermarks must satisfy 1 <= low < high < 100"
        )

    limits_table = _table(raw, "limits", required=False)
    _reject_unknown(
        limits_table,
        {
            "max_source_bytes",
            "max_pages",
            "max_pixels_per_page",
            "room_code_max_length",
            "quantity_max",
            "callback_payload_max_bytes",
            "candidate_limit",
            "document_code_pattern",
            "room_code_pattern",
        },
        "limits",
    )
    limits = LimitConfig(
        max_source_bytes=_positive_int(limits_table, "max_source_bytes", 50 * 1024 * 1024),
        max_pages=_positive_int(limits_table, "max_pages", 100),
        max_pixels_per_page=_positive_int(
            limits_table, "max_pixels_per_page", 50_000_000
        ),
        room_code_max_length=_positive_int(limits_table, "room_code_max_length", 4),
        quantity_max=_positive_int(limits_table, "quantity_max", 999),
        callback_payload_max_bytes=_positive_int(
            limits_table, "callback_payload_max_bytes", 512 * 1024
        ),
        candidate_limit=_positive_int(limits_table, "candidate_limit", 5),
        document_code_pattern=_string(
            limits_table, "document_code_pattern", r"\d{6}"
        ),
        room_code_pattern=_string(
            limits_table, "room_code_pattern", r"[A-Za-z0-9]{1,4}"
        ),
    )
    _validate_limit_contract(limits)

    callback_table = _table(raw, "callback")
    _reject_unknown(
        callback_table,
        {
            "url",
            "token_env",
            "token_file",
            "artifact_token_env",
            "artifact_token_file",
            "timeout_seconds",
            "retry_base_seconds",
            "retry_max_seconds",
        },
        "callback",
    )
    url = _required_string(callback_table, "url")
    _validate_callback_url(url)
    env = os.environ if environment is None else environment
    callback_token = _load_secret(callback_table, "token", env, required=True)
    if callback_token is None:
        raise ConfigError("callback token is required")
    callback = CallbackConfig(
        url=url,
        token=callback_token,
        artifact_token=_load_secret(callback_table, "artifact_token", env, required=False),
        timeout_seconds=_positive_float(callback_table, "timeout_seconds", 10.0),
        retry_base_seconds=_positive_float(callback_table, "retry_base_seconds", 2.0),
        retry_max_seconds=_positive_float(callback_table, "retry_max_seconds", 300.0),
    )
    if callback.retry_max_seconds < callback.retry_base_seconds:
        raise ConfigError("callback.retry_max_seconds must be at least retry_base_seconds")
    if (
        callback.artifact_token is not None
        and callback.artifact_token.reveal() == callback.token.reveal()
    ):
        raise ConfigError("callback and artifact tokens must be different")

    api_table = _table(raw, "api", required=False)
    _reject_unknown(
        api_table,
        {
            "enabled",
            "bind_host",
            "port",
            "public_base_url",
            "tls_cert_file",
            "tls_key_file",
            "tls_terminated_upstream",
        },
        "api",
    )
    api = ApiConfig(
        enabled=_bool(api_table, "enabled", False),
        bind_host=_string(api_table, "bind_host", "127.0.0.1"),
        port=_positive_int(api_table, "port", 8443),
        public_base_url=_string(
            api_table, "public_base_url", "https://127.0.0.1:8443"
        ).rstrip("/"),
        tls_cert_file=(
            _absolute_optional_path(api_table, "tls_cert_file")
            if "tls_cert_file" in api_table
            else None
        ),
        tls_key_file=(
            _absolute_optional_path(api_table, "tls_key_file")
            if "tls_key_file" in api_table
            else None
        ),
        tls_terminated_upstream=_bool(api_table, "tls_terminated_upstream", False),
    )
    if not 1 <= api.port <= 65535:
        raise ConfigError("api.port must be between 1 and 65535")
    _validate_https_url(api.public_base_url)
    if api.enabled:
        if api.tls_cert_file is None and api.tls_key_file is None:
            if not api.tls_terminated_upstream:
                raise ConfigError(
                    "enabled api requires TLS certificate/key or tls_terminated_upstream=true"
                )
        elif api.tls_cert_file is None or api.tls_key_file is None:
            raise ConfigError("api.tls_cert_file and api.tls_key_file must be configured together")
        elif (
            not api.tls_cert_file.is_file()
            or not os.access(api.tls_cert_file, os.R_OK)
            or not api.tls_key_file.is_file()
            or not os.access(api.tls_key_file, os.R_OK)
        ):
            raise ConfigError("api TLS certificate and key must be readable regular files")
        if callback.artifact_token is None:
            raise ConfigError("enabled api requires callback artifact_token")

    version_table = _table(raw, "versions")
    _reject_unknown(
        version_table,
        {
            "config_schema",
            "callback_schema",
            "template",
            "preprocessing",
            "model",
            "thresholds",
            "catalogue",
        },
        "versions",
    )
    versions = VersionConfig(
        config_schema=_required_string(version_table, "config_schema"),
        callback_schema=_required_string(version_table, "callback_schema"),
        template=_required_string(version_table, "template"),
        preprocessing=_required_string(version_table, "preprocessing"),
        model=_required_string(version_table, "model"),
        thresholds=_required_string(version_table, "thresholds"),
        catalogue=_required_string(version_table, "catalogue"),
    )

    retention_table = _table(raw, "retention", required=False)
    _reject_unknown(retention_table, {"artifact_days", "audit_days"}, "retention")
    retention = RetentionConfig(
        artifact_days=_positive_int(retention_table, "artifact_days", 30),
        audit_days=_positive_int(retention_table, "audit_days", 365),
    )
    if retention.audit_days < retention.artifact_days:
        raise ConfigError("retention.audit_days must be at least retention.artifact_days")

    scanner_table = _table(raw, "scanner", required=False)
    _reject_unknown(
        scanner_table,
        {
            "allowed_extensions",
            "staging_suffixes",
            "ready_suffix",
            "stable_observations",
            "stable_seconds",
            "minimum_age_seconds",
            "poll_interval_seconds",
            "decode_timeout_seconds",
            "decode_memory_mb",
            "pdf_dpi",
            "service_date_timezone",
            "service_date_offset_days",
        },
        "scanner",
    )
    scanner = ScannerConfig(
        allowed_extensions=tuple(
            item.lower()
            for item in _string_tuple(
                scanner_table,
                "allowed_extensions",
                ScannerConfig().allowed_extensions,
            )
        ),
        staging_suffixes=_string_tuple(
            scanner_table,
            "staging_suffixes",
            ScannerConfig().staging_suffixes,
        ),
        ready_suffix=_optional_string(scanner_table, "ready_suffix"),
        stable_observations=_positive_int(scanner_table, "stable_observations", 3),
        stable_seconds=_positive_int(scanner_table, "stable_seconds", 10),
        minimum_age_seconds=_positive_int(scanner_table, "minimum_age_seconds", 10),
        poll_interval_seconds=_positive_int(scanner_table, "poll_interval_seconds", 3),
        decode_timeout_seconds=_positive_int(scanner_table, "decode_timeout_seconds", 30),
        decode_memory_mb=_positive_int(scanner_table, "decode_memory_mb", 512),
        pdf_dpi=_positive_int(scanner_table, "pdf_dpi", 150),
        service_date_timezone=_string(
            scanner_table, "service_date_timezone", ScannerConfig().service_date_timezone
        ),
        service_date_offset_days=_non_negative_int(
            scanner_table,
            "service_date_offset_days",
            ScannerConfig().service_date_offset_days,
        ),
    )
    _validate_scanner_contract(scanner)

    recognition_table = _table(raw, "recognition", required=False)
    _reject_unknown(
        recognition_table,
        {
            "enabled",
            "auto_accept_enabled",
            "model_name",
            "model_dir",
            "catalogue_path",
            "cpu_threads",
            "minimum_item_score",
            "minimum_item_margin",
        },
        "recognition",
    )
    recognition = RecognitionConfig(
        enabled=_bool(recognition_table, "enabled", False),
        auto_accept_enabled=_bool(recognition_table, "auto_accept_enabled", False),
        model_name=_string(
            recognition_table,
            "model_name",
            RecognitionConfig().model_name,
        ),
        model_dir=_optional_local_path(
            recognition_table,
            "model_dir",
            base,
            context="recognition",
        ),
        catalogue_path=_optional_local_path(
            recognition_table,
            "catalogue_path",
            base,
            context="recognition",
            is_file=True,
        ),
        cpu_threads=_positive_int(recognition_table, "cpu_threads", 4),
        minimum_item_score=_unit_float(
            recognition_table,
            "minimum_item_score",
            RecognitionConfig().minimum_item_score,
        ),
        minimum_item_margin=_unit_float(
            recognition_table,
            "minimum_item_margin",
            RecognitionConfig().minimum_item_margin,
        ),
    )
    if recognition.model_dir is not None and not recognition.model_dir.is_dir():
        raise ConfigError("recognition.model_dir must be an existing directory")
    if recognition.catalogue_path is not None and not recognition.catalogue_path.is_file():
        raise ConfigError("recognition.catalogue_path must be an existing file")
    if recognition.catalogue_path is not None:
        recognition = RecognitionConfig(
            enabled=recognition.enabled,
            auto_accept_enabled=recognition.auto_accept_enabled,
            model_name=recognition.model_name,
            model_dir=recognition.model_dir,
            catalogue_path=recognition.catalogue_path,
            cpu_threads=recognition.cpu_threads,
            minimum_item_score=recognition.minimum_item_score,
            minimum_item_margin=recognition.minimum_item_margin,
            catalogue_sha256=sha256_file(recognition.catalogue_path),
        )
    placeholder_versions = {"none", "unimplemented", "unselected", "unconfigured"}
    if recognition.enabled and versions.model.casefold() in placeholder_versions:
        raise ConfigError("enabled recognition requires a concrete versions.model")
    if recognition.enabled and versions.thresholds.casefold() in placeholder_versions:
        raise ConfigError("enabled recognition requires a concrete versions.thresholds")
    if recognition.auto_accept_enabled and recognition.catalogue_path is None:
        raise ConfigError("recognition auto-accept requires catalogue_path")

    return AppConfig(
        paths=paths,
        service=service,
        limits=limits,
        callback=callback,
        api=api,
        versions=versions,
        retention=retention,
        scanner=scanner,
        recognition=recognition,
    )


def ensure_runtime_directories(config: AppConfig) -> None:
    for path in (config.paths.database.parent, config.paths.spool, config.paths.artifacts):
        path.mkdir(parents=True, exist_ok=True)
        _assert_local_filesystem(path, "runtime path")


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    try:
        with path.open("rb") as stream:
            for chunk in iter(lambda: stream.read(1024 * 1024), b""):
                digest.update(chunk)
    except OSError as exc:
        raise ConfigError(f"cannot read file for fingerprint: {path}") from exc
    return digest.hexdigest()


def _table(raw: Mapping[str, Any], name: str, *, required: bool = True) -> Mapping[str, Any]:
    value = raw.get(name)
    if value is None and not required:
        return {}
    if not isinstance(value, dict):
        raise ConfigError(f"{name} must be a TOML table")
    return value


def _reject_unknown(raw: Mapping[str, Any], allowed: set[str], context: str) -> None:
    unknown = sorted(set(raw) - allowed)
    if unknown:
        raise ConfigError(f"unknown {context} configuration key: {unknown[0]}")


def _required_string(raw: Mapping[str, Any], name: str) -> str:
    value = raw.get(name)
    if not isinstance(value, str) or not value.strip():
        raise ConfigError(f"{name} must be a non-empty string")
    return value.strip()


def _string(raw: Mapping[str, Any], name: str, default: str) -> str:
    value = raw.get(name, default)
    if not isinstance(value, str) or not value:
        raise ConfigError(f"{name} must be a non-empty string")
    return value


def _optional_string(raw: Mapping[str, Any], name: str) -> str | None:
    value = raw.get(name)
    if value is None:
        return None
    if not isinstance(value, str) or not value:
        raise ConfigError(f"{name} must be a non-empty string when configured")
    return value


def _string_tuple(
    raw: Mapping[str, Any], name: str, default: tuple[str, ...]
) -> tuple[str, ...]:
    value = raw.get(name, list(default))
    if (
        not isinstance(value, list)
        or not value
        or any(not isinstance(item, str) or not item for item in value)
    ):
        raise ConfigError(f"{name} must be a non-empty array of strings")
    return tuple(value)


def _positive_int(raw: Mapping[str, Any], name: str, default: int) -> int:
    value = raw.get(name, default)
    if isinstance(value, bool) or not isinstance(value, int) or value < 1:
        raise ConfigError(f"{name} must be a positive integer")
    return value


def _non_negative_int(raw: Mapping[str, Any], name: str, default: int) -> int:
    value = raw.get(name, default)
    if isinstance(value, bool) or not isinstance(value, int) or value < 0:
        raise ConfigError(f"{name} must be a non-negative integer")
    return value


def _positive_float(raw: Mapping[str, Any], name: str, default: float) -> float:
    value = raw.get(name, default)
    if isinstance(value, bool) or not isinstance(value, (int, float)) or value <= 0:
        raise ConfigError(f"{name} must be positive")
    return float(value)


def _unit_float(raw: Mapping[str, Any], name: str, default: float) -> float:
    value = raw.get(name, default)
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not 0.0 <= value <= 1.0:
        raise ConfigError(f"{name} must be between 0 and 1")
    return float(value)


def _bool(raw: Mapping[str, Any], name: str, default: bool) -> bool:
    value = raw.get(name, default)
    if not isinstance(value, bool):
        raise ConfigError(f"{name} must be boolean")
    return value


def _path_value(raw: Mapping[str, Any], name: str, base: Path) -> Path:
    value = _required_string(raw, name)
    if "://" in value or value.startswith(("\\\\", "//")):
        raise ConfigError(f"paths.{name} must be a local filesystem path")
    path = Path(value).expanduser()
    if not path.is_absolute():
        path = base / path
    return path.resolve(strict=False)


def _share_path(raw: Mapping[str, Any], name: str, base: Path) -> Path:
    value = _required_string(raw, name)
    if "://" in value:
        raise ConfigError(f"paths.{name} must be a filesystem path")
    path = Path(value).expanduser()
    if not path.is_absolute():
        path = base / path
    return path.resolve(strict=False)


def _local_path(raw: Mapping[str, Any], name: str, base: Path, *, is_file: bool = False) -> Path:
    path = _path_value(raw, name, base)
    check_path = path.parent if is_file else path
    _assert_local_filesystem(check_path, f"paths.{name}")
    return path


def _optional_local_path(
    raw: Mapping[str, Any],
    name: str,
    base: Path,
    *,
    context: str,
    is_file: bool = False,
) -> Path | None:
    value = raw.get(name)
    if value is None:
        return None
    if not isinstance(value, str) or not value.strip():
        raise ConfigError(f"{context}.{name} must be a non-empty local filesystem path")
    if "://" in value or value.startswith(("\\\\", "//")):
        raise ConfigError(f"{context}.{name} must be a local filesystem path")
    path = Path(value).expanduser()
    if not path.is_absolute():
        path = base / path
    path = path.resolve(strict=False)
    _assert_local_filesystem(path.parent if is_file else path, f"{context}.{name}")
    return path


def _absolute_optional_path(raw: Mapping[str, Any], name: str) -> Path:
    value = raw.get(name)
    if not isinstance(value, str) or not value:
        raise ConfigError(f"api.{name} must be an absolute file path")
    path = Path(value).expanduser()
    if not path.is_absolute():
        raise ConfigError(f"api.{name} must be an absolute file path")
    return path


def _assert_local_filesystem(path: Path, label: str) -> None:
    existing = path
    while not existing.exists() and existing != existing.parent:
        existing = existing.parent
    filesystem = _filesystem_type(existing)
    if filesystem is None:
        raise ConfigError(f"{label} filesystem locality cannot be verified")
    if filesystem.lower() in _NETWORK_FILESYSTEMS:
        raise ConfigError(f"{label} must not use a network filesystem")


def _filesystem_type(path: Path) -> str | None:
    system = platform.system()
    if system == "Windows":
        return _windows_drive_type(path)
    if system == "Linux":
        return _linux_filesystem_type(path)
    if system in {"Darwin", "FreeBSD"}:
        try:
            result = subprocess.run(
                ["stat", "-f", "%T", str(path)],
                check=True,
                capture_output=True,
                text=True,
                timeout=5,
            )
        except (OSError, subprocess.SubprocessError):
            return None
        return result.stdout.strip() or None
    return None


def _windows_drive_type(path: Path) -> str | None:
    anchor = path.anchor
    if not anchor:
        return None
    drive_type = ctypes.windll.kernel32.GetDriveTypeW(anchor)  # type: ignore[attr-defined]
    return {2: "removable", 3: "fixed", 4: "remote", 5: "cdrom", 6: "ramdisk"}.get(
        drive_type
    )


def _linux_filesystem_type(path: Path) -> str | None:
    try:
        lines = Path("/proc/self/mountinfo").read_text(encoding="utf-8").splitlines()
    except OSError:
        return None
    target = str(path.resolve())
    best: tuple[int, str] | None = None
    for line in lines:
        fields = line.split()
        try:
            separator = fields.index("-")
            mount_point = _decode_mount_field(fields[4])
            filesystem = fields[separator + 1]
        except (IndexError, ValueError):
            continue
        try:
            contains = os.path.commonpath((target, mount_point)) == mount_point
        except ValueError:
            contains = False
        if contains and (best is None or len(mount_point) > best[0]):
            best = (len(mount_point), filesystem)
    return best[1] if best else None


def _decode_mount_field(value: str) -> str:
    return (
        value.replace("\\040", " ")
        .replace("\\011", "\t")
        .replace("\\012", "\n")
        .replace("\\134", "\\")
    )


def _validate_non_overlapping_paths(paths: PathConfig) -> None:
    roots = {
        "database": paths.database,
        "spool": paths.spool,
        "artifacts": paths.artifacts,
    }
    items = list(roots.items())
    for index, (left_name, left) in enumerate(items):
        for right_name, right in items[index + 1 :]:
            if left == right or left in right.parents or right in left.parents:
                raise ConfigError(
                    f"paths.{left_name} and paths.{right_name} must not overlap"
                )
    if paths.inbox is not None:
        for name, local_path in roots.items():
            if (
                paths.inbox == local_path
                or paths.inbox in local_path.parents
                or local_path in paths.inbox.parents
            ):
                raise ConfigError(f"paths.inbox and paths.{name} must not overlap")


def _validate_limit_contract(limits: LimitConfig) -> None:
    if limits.room_code_max_length > 4:
        raise ConfigError("room_code_max_length must not exceed 4")
    try:
        document_pattern = re.compile(limits.document_code_pattern)
        room_pattern = re.compile(limits.room_code_pattern)
    except re.error:
        raise ConfigError("configured validation regex is invalid") from None
    if document_pattern.fullmatch("000001") is None or document_pattern.fullmatch("ABC123"):
        raise ConfigError("document_code_pattern must accept exactly six digits")
    if room_pattern.fullmatch("A1") is None or room_pattern.fullmatch("A-1"):
        raise ConfigError("room_code_pattern must accept only alphanumeric room codes")
    if room_pattern.fullmatch("A" * (limits.room_code_max_length + 1)):
        raise ConfigError("room_code_pattern exceeds room_code_max_length")


def _validate_scanner_contract(scanner: ScannerConfig) -> None:
    supported = {".png", ".jpg", ".jpeg", ".tif", ".tiff", ".pdf"}
    extensions = tuple(item.lower() for item in scanner.allowed_extensions)
    if any(not item.startswith(".") or item not in supported for item in extensions):
        raise ConfigError("scanner.allowed_extensions contains an unsupported format")
    if len(extensions) != len(set(extensions)):
        raise ConfigError("scanner.allowed_extensions contains duplicates")
    if any(not item.startswith(".") for item in scanner.staging_suffixes):
        raise ConfigError("scanner.staging_suffixes must contain filename suffixes")
    if scanner.ready_suffix is not None and not scanner.ready_suffix.startswith("."):
        raise ConfigError("scanner.ready_suffix must be a filename suffix")
    if scanner.pdf_dpi < 72 or scanner.pdf_dpi > 600:
        raise ConfigError("scanner.pdf_dpi must be between 72 and 600")
    try:
        ZoneInfo(scanner.service_date_timezone)
    except ZoneInfoNotFoundError:
        raise ConfigError("scanner.service_date_timezone is not installed") from None


def _validate_callback_url(value: str) -> None:
    try:
        parsed = urlsplit(value)
        _port = parsed.port
    except ValueError:
        raise ConfigError("callback.url must be a valid HTTPS URL") from None
    hostname = parsed.hostname.casefold() if parsed.hostname else None
    loopback_http = parsed.scheme == "http" and hostname in {"localhost", "127.0.0.1", "::1"}
    if (
        parsed.scheme != "https" and not loopback_http
        or not parsed.hostname
        or parsed.username
        or parsed.password
        or parsed.query
        or parsed.fragment
    ):
        raise ConfigError(
            "callback.url must be an HTTPS URL, or an HTTP URL for a loopback "
            "development endpoint, without embedded credentials"
        )


def _validate_https_url(value: str) -> None:
    """Validate an origin or artifact URL, which must always use HTTPS."""
    try:
        parsed = urlsplit(value)
        _port = parsed.port
    except ValueError:
        raise ConfigError("callback.url must be a valid HTTPS URL") from None
    if (
        parsed.scheme != "https"
        or not parsed.hostname
        or parsed.username
        or parsed.password
        or parsed.query
        or parsed.fragment
    ):
        raise ConfigError("callback.url must be an HTTPS URL without embedded credentials")


def _load_secret(
    raw: Mapping[str, Any],
    prefix: str,
    environment: Mapping[str, str],
    *,
    required: bool,
) -> SecretValue | None:
    env_key = f"{prefix}_env"
    file_key = f"{prefix}_file"
    env_name = raw.get(env_key)
    file_name = raw.get(file_key)
    configured = int(env_name is not None) + int(file_name is not None)
    if configured == 0 and not required:
        return None
    if configured != 1:
        raise ConfigError(f"configure exactly one of callback.{env_key} or callback.{file_key}")
    if env_name is not None:
        if not isinstance(env_name, str) or not env_name:
            raise ConfigError(f"callback.{env_key} must name an environment variable")
        value = environment.get(env_name)
        if not value:
            raise ConfigError(f"secret environment variable {env_name} is missing or empty")
        return SecretValue(value)
    if not isinstance(file_name, str) or not file_name:
        raise ConfigError(f"callback.{file_key} must be an absolute file path")
    secret_path = Path(file_name).expanduser()
    if not secret_path.is_absolute():
        raise ConfigError(f"callback.{file_key} must be an absolute file path")
    try:
        stat = secret_path.stat()
        if not secret_path.is_file():
            raise ConfigError(f"callback.{file_key} must reference a regular file")
        _validate_secret_file_permissions(stat.st_mode, file_key, os.name)
        value = secret_path.read_text(encoding="utf-8").strip()
    except ConfigError:
        raise
    except OSError as exc:
        raise ConfigError(f"cannot read callback.{file_key}: {type(exc).__name__}") from None
    return SecretValue(value)


def _validate_secret_file_permissions(mode: int, file_key: str, platform_name: str) -> None:
    if platform_name == "nt":
        raise ConfigError(
            f"callback.{file_key} cannot be securely validated on Windows; "
            "use an environment variable"
        )
    if mode & 0o077:
        raise ConfigError(f"callback.{file_key} must be owner-readable only")
