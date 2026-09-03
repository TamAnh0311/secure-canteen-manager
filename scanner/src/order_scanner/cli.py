from __future__ import annotations

import argparse
import json
import logging
import multiprocessing
import signal
import sys
import threading
import time
import uuid
from multiprocessing.process import BaseProcess
from pathlib import Path
from types import FrameType

from order_scanner.api import ArtifactApiServer, build_tls_context
from order_scanner.artifacts import ArtifactStoreError, ImmutableFileStore
from order_scanner.callbacks import CallbackDispatcher, RetryPolicy
from order_scanner.catalogue import CatalogueError, CatalogueIndex, RankingPolicy, load_catalogue
from order_scanner.config import (
    AppConfig,
    ConfigError,
    LimitConfig,
    RecognitionConfig,
    ensure_runtime_directories,
    load_config,
    sha256_file,
)
from order_scanner.contracts import PipelineVersions
from order_scanner.ingestion import IngestionService, ScannerInbox
from order_scanner.paddleocr_backend import (
    PaddleOCRBackend,
    PaddleOCRUnavailableError,
    validate_paddleocr_installation,
)
from order_scanner.pipeline import PageProcessor, StopSignal, run_worker_loop
from order_scanner.recognition import RecognitionEngine, RecognitionPolicy
from order_scanner.runtime import DiskPressureController
from order_scanner.storage import Storage, StorageError

LOGGER = logging.getLogger("order_scanner")


def main(argv: list[str] | None = None) -> int:
    parser = _build_parser()
    args = parser.parse_args(argv)
    _configure_logging(args.verbose)
    try:
        return int(args.handler(args))
    except (
        ArtifactStoreError,
        CatalogueError,
        ConfigError,
        PaddleOCRUnavailableError,
        StorageError,
    ) as exc:
        LOGGER.error("operation refused: %s", exc)
        return 2
    except KeyboardInterrupt:
        return 0


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="order-scanner")
    parser.add_argument("--verbose", action="store_true", help="enable diagnostic logging")
    subparsers = parser.add_subparsers(dest="command", required=True)
    for name, handler, help_text in (
        ("check-config", _check_config, "validate configuration without mutating state"),
        ("migrate", _migrate, "apply ordered local SQLite migrations"),
        ("status", _status, "show durable job counts"),
        ("serve", _serve, "run the foreground service"),
    ):
        subparser = subparsers.add_parser(name, help=help_text)
        subparser.add_argument(
            "--config", type=Path, default=Path("config.toml"), help="TOML configuration path"
        )
        subparser.set_defaults(handler=handler)
    replay = subparsers.add_parser(
        "replay-callback", help="requeue one callback using its original event and payload"
    )
    replay.add_argument("event_id", help="stable callback event ID")
    replay.add_argument(
        "--config", type=Path, default=Path("config.toml"), help="TOML configuration path"
    )
    replay.set_defaults(handler=_replay_callback)
    return parser


def _check_config(args: argparse.Namespace) -> int:
    config = load_config(args.config)
    _validate_recognition_configuration(config)
    print(_config_summary(config))
    return 0


def _migrate(args: argparse.Namespace) -> int:
    config = _load_and_prepare(args.config)
    Storage(
        config.paths.database,
        artifact_root=config.paths.artifacts,
        busy_timeout_ms=config.service.sqlite_busy_timeout_ms,
    ).migrate(
        config.paths.migrations
    )
    print(f"migrated {config.paths.database}")
    return 0


def _status(args: argparse.Namespace) -> int:
    config = load_config(args.config)
    if not config.paths.database.exists():
        print("{}")
        return 0
    storage = Storage(
        config.paths.database,
        artifact_root=config.paths.artifacts,
        busy_timeout_ms=config.service.sqlite_busy_timeout_ms,
    )
    print(json.dumps(storage.status_counts(), sort_keys=True))
    return 0


def _replay_callback(args: argparse.Namespace) -> int:
    config = _load_and_prepare(args.config)
    storage = _storage(config)
    storage.migrate(config.paths.migrations)
    storage.replay_outbox(str(args.event_id))
    print(f"requeued {args.event_id}")
    return 0


def _serve(args: argparse.Namespace) -> int:
    config = _load_and_prepare(args.config)
    _validate_recognition_runtime(config)
    storage = _storage(config)
    storage.migrate(config.paths.migrations)
    recovered = storage.recover_expired_leases(max_attempts=config.service.max_job_attempts)
    recovered_callbacks = storage.recover_expired_outbox_leases()
    ingestion: IngestionService | None = None
    if config.paths.inbox is not None:
        source_store = ImmutableFileStore(config.paths.spool)
        artifact_store = ImmutableFileStore(config.paths.artifacts)
        ingestion = IngestionService(
            inbox=ScannerInbox(config.paths.inbox, config.scanner),
            source_store=source_store,
            artifact_store=artifact_store,
            storage=storage,
            limits=config.limits,
            scanner=config.scanner,
            bundle_fingerprint=config.bundle_fingerprint(),
        )
        reconciliation = ingestion.reconcile_startup()
        LOGGER.info(
            "ingestion reconciled; receipts=%d incomplete=%d "
            "legacy_without_service_date=%d temporary_removed=%d",
            reconciliation.receipts_replayed,
            reconciliation.incomplete_receipts,
            reconciliation.legacy_receipts_without_service_date,
            reconciliation.temporary_files_removed,
        )
    disk = DiskPressureController(
        config.paths.artifacts,
        high_watermark_percent=config.service.disk_high_watermark_percent,
        low_watermark_percent=config.service.disk_low_watermark_percent,
    )
    stop_event = threading.Event()
    process_stop = multiprocessing.get_context("spawn").Event()
    worker_processes: list[BaseProcess] = []
    callback_thread: threading.Thread | None = None
    api: ArtifactApiServer | None = None
    def stop(_signum: int, _frame: FrameType | None) -> None:
        stop_event.set()
        process_stop.set()

    previous_handlers = {
        signal.SIGINT: signal.getsignal(signal.SIGINT),
        signal.SIGTERM: signal.getsignal(signal.SIGTERM),
    }
    signal.signal(signal.SIGINT, stop)
    signal.signal(signal.SIGTERM, stop)
    try:
        worker_processes, callback_thread, api = _start_runtime(
            config=config,
            storage=storage,
            disk=disk,
            stop_event=stop_event,
            process_stop=process_stop,
        )
        LOGGER.info(
            "service ready; recovered_leases=%d recovered_callbacks=%d workers=%d intake=%s api=%s",
            recovered,
            recovered_callbacks,
            config.service.workers,
            "enabled" if ingestion is not None else "disabled",
            "enabled" if api is not None else "disabled",
        )
        next_recovery = time.monotonic() + config.service.recovery_interval_seconds
        while not stop_event.is_set():
            disk_status = disk.refresh()
            if ingestion is not None and not disk_status.intake_paused:
                ingested = ingestion.poll_once()
                if ingested:
                    LOGGER.info(
                        "ingested sources=%d pages=%d",
                        len(ingested),
                        sum(len(result.pages) for result in ingested),
                    )
            if time.monotonic() >= next_recovery:
                storage.recover_expired_leases(max_attempts=config.service.max_job_attempts)
                storage.recover_expired_outbox_leases()
                next_recovery = time.monotonic() + config.service.recovery_interval_seconds
            stop_event.wait(config.scanner.poll_interval_seconds)
    finally:
        stop_event.set()
        process_stop.set()
        _cleanup_runtime(
            api=api,
            callback_thread=callback_thread,
            worker_processes=worker_processes,
            callback_timeout_seconds=config.callback.timeout_seconds,
        )
        for signum, handler in previous_handlers.items():
            signal.signal(signum, handler)
    return 0


def _start_runtime(
    *,
    config: AppConfig,
    storage: Storage,
    disk: DiskPressureController,
    stop_event: threading.Event,
    process_stop: StopSignal,
) -> tuple[list[BaseProcess], threading.Thread, ArtifactApiServer | None]:
    process_context = multiprocessing.get_context("spawn")
    versions = _pipeline_versions(config)
    worker_processes: list[BaseProcess] = []
    callback_thread: threading.Thread | None = None
    api: ArtifactApiServer | None = None
    try:
        for index in range(config.service.workers):
            worker_id = f"processor-{index}-{uuid.uuid4().hex[:8]}"
            started_process = process_context.Process(
                target=_processing_worker_main,
                kwargs={
                    "database_path": config.paths.database,
                    "artifact_root": config.paths.artifacts,
                    "source_root": config.paths.spool,
                    "busy_timeout_ms": config.service.sqlite_busy_timeout_ms,
                    "versions": versions,
                    "artifact_base_url": config.api.public_base_url,
                    "payload_max_bytes": config.limits.callback_payload_max_bytes,
                    "recognition_config": config.recognition,
                    "limits": config.limits,
                    "worker_id": worker_id,
                    "lease_seconds": config.service.lease_seconds,
                    "max_attempts": config.service.max_job_attempts,
                    "poll_interval_seconds": min(
                        1.0, float(config.scanner.poll_interval_seconds)
                    ),
                    "stop_event": process_stop,
                },
                name=worker_id,
            )
            started_process.start()
            worker_processes.append(started_process)

        callback_thread = threading.Thread(
            target=_callback_loop,
            args=(config, stop_event),
            name="callback-dispatcher",
            daemon=True,
        )
        callback_thread.start()

        if config.api.enabled:
            tls_context = (
                build_tls_context(config.api.tls_cert_file, config.api.tls_key_file)
                if config.api.tls_cert_file is not None
                and config.api.tls_key_file is not None
                else None
            )
            api = ArtifactApiServer(
                storage=storage,
                artifact_root=config.paths.artifacts,
                artifact_token=config.callback.artifact_token,
                bind_host=config.api.bind_host,
                port=config.api.port,
                readiness=lambda: _readiness(storage, disk, worker_processes, callback_thread),
                metrics=lambda: _metrics(storage, disk, worker_processes, callback_thread),
                tls_context=tls_context,
            )
            api.start()
    except BaseException:
        stop_event.set()
        process_stop.set()
        _cleanup_runtime(
            api=api,
            callback_thread=callback_thread,
            worker_processes=worker_processes,
            callback_timeout_seconds=config.callback.timeout_seconds,
        )
        raise
    if callback_thread is None:
        raise RuntimeError("callback dispatcher failed to start")
    return worker_processes, callback_thread, api


def _cleanup_runtime(
    *,
    api: ArtifactApiServer | None,
    callback_thread: threading.Thread | None,
    worker_processes: list[BaseProcess],
    callback_timeout_seconds: float,
) -> None:
    if api is not None:
        api.stop()
    if callback_thread is not None:
        callback_thread.join(timeout=max(2.0, callback_timeout_seconds + 1))
    for worker_process in worker_processes:
        worker_process.join(timeout=5)
        if worker_process.is_alive():
            worker_process.terminate()
            worker_process.join(timeout=5)


def _load_and_prepare(path: Path) -> AppConfig:
    config = load_config(path)
    ensure_runtime_directories(config)
    return config


def _config_summary(config: AppConfig) -> str:
    return json.dumps(
        {
            "database": str(config.paths.database),
            "spool": str(config.paths.spool),
            "artifacts": str(config.paths.artifacts),
            "inbox": str(config.paths.inbox) if config.paths.inbox else None,
            "migrations": str(config.paths.migrations),
            "workers": config.service.workers,
            "scanner_formats": list(config.scanner.allowed_extensions),
            "callback_url": config.callback.url,
            "callback_token": "configured",
            "artifact_token": "configured" if config.callback.artifact_token else "not configured",
            "api_enabled": config.api.enabled,
            "api_public_base_url": config.api.public_base_url,
            "recognition_enabled": config.recognition.enabled,
            "recognition_auto_accept_enabled": config.recognition.auto_accept_enabled,
            "recognition_model": config.recognition.model_name,
            "recognition_catalogue": (
                str(config.recognition.catalogue_path)
                if config.recognition.catalogue_path is not None
                else None
            ),
            "bundle_fingerprint": config.bundle_fingerprint(),
        },
        sort_keys=True,
    )


def _storage(config: AppConfig) -> Storage:
    return Storage(
        config.paths.database,
        artifact_root=config.paths.artifacts,
        busy_timeout_ms=config.service.sqlite_busy_timeout_ms,
    )


def _pipeline_versions(config: AppConfig) -> PipelineVersions:
    return PipelineVersions(
        bundle_fingerprint=config.bundle_fingerprint(),
        config_schema=config.versions.config_schema,
        callback_schema=config.versions.callback_schema,
        template=config.versions.template,
        preprocessing=config.versions.preprocessing,
        model=config.versions.model,
        thresholds=config.versions.thresholds,
        catalogue=config.versions.catalogue,
    )


def _processing_worker_main(
    *,
    database_path: Path,
    artifact_root: Path,
    source_root: Path,
    busy_timeout_ms: int,
    versions: PipelineVersions,
    artifact_base_url: str,
    payload_max_bytes: int,
    recognition_config: RecognitionConfig,
    limits: LimitConfig,
    worker_id: str,
    lease_seconds: int,
    max_attempts: int,
    poll_interval_seconds: float,
    stop_event: StopSignal,
) -> None:
    signal.signal(signal.SIGINT, signal.SIG_IGN)
    storage = Storage(
        database_path,
        artifact_root=artifact_root,
        busy_timeout_ms=busy_timeout_ms,
    )
    recognition = _build_recognition_engine(recognition_config, limits)
    processor = PageProcessor(
        storage=storage,
        artifact_store=ImmutableFileStore(artifact_root),
        source_root=source_root,
        versions=versions,
        artifact_base_url=artifact_base_url,
        payload_max_bytes=payload_max_bytes,
        recognition=recognition,
    )
    run_worker_loop(
        processor=processor,
        storage=storage,
        worker_id=worker_id,
        lease_seconds=lease_seconds,
        poll_interval_seconds=poll_interval_seconds,
        stop_event=stop_event,
        max_attempts=max_attempts,
    )


def _validate_recognition_runtime(config: AppConfig) -> None:
    _validate_recognition_configuration(config)
    if not config.recognition.enabled:
        return
    backend = PaddleOCRBackend(
        model_name=config.recognition.model_name,
        model_dir=config.recognition.model_dir,
        cpu_threads=config.recognition.cpu_threads,
    )
    try:
        backend.close()
    except Exception as exc:
        raise PaddleOCRUnavailableError("PaddleOCR model cleanup failed") from exc


def _validate_recognition_configuration(config: AppConfig) -> None:
    if not config.recognition.enabled:
        return
    validate_paddleocr_installation()
    if config.recognition.catalogue_path is not None:
        catalogue = load_catalogue(config.recognition.catalogue_path)
        if catalogue.version != config.versions.catalogue:
            raise ConfigError(
                "recognition catalogue version does not match versions.catalogue"
            )
        if config.recognition.catalogue_sha256 != sha256_file(config.recognition.catalogue_path):
            raise ConfigError("recognition catalogue changed after configuration load")


def _build_recognition_engine(
    config: RecognitionConfig,
    limits: LimitConfig,
) -> RecognitionEngine | None:
    if not config.enabled:
        return None
    catalogue = None
    if config.catalogue_path is not None:
        catalogue_document = load_catalogue(config.catalogue_path)
        if (
            config.catalogue_sha256 is not None
            and config.catalogue_sha256 != sha256_file(config.catalogue_path)
        ):
            raise ConfigError("recognition catalogue changed after configuration load")
        catalogue = CatalogueIndex(catalogue_document)
    backend = PaddleOCRBackend(
        model_name=config.model_name,
        model_dir=config.model_dir,
        cpu_threads=config.cpu_threads,
    )
    policy = RecognitionPolicy(
        room_max_length=limits.room_code_max_length,
        quantity_max=limits.quantity_max,
        candidate_limit=limits.candidate_limit,
        auto_accept_enabled=config.auto_accept_enabled,
        item_ranking=RankingPolicy(
            minimum_score=config.minimum_item_score,
            minimum_margin=config.minimum_item_margin,
            candidate_limit=limits.candidate_limit,
        ),
    )
    return RecognitionEngine(backend, catalogue=catalogue, policy=policy)


def _callback_loop(config: AppConfig, stop_event: threading.Event) -> None:
    storage = _storage(config)
    dispatcher = CallbackDispatcher(
        storage=storage,
        url=config.callback.url,
        token=config.callback.token,
        lease_seconds=max(config.service.lease_seconds, int(config.callback.timeout_seconds) + 5),
        timeout_seconds=config.callback.timeout_seconds,
        payload_max_bytes=config.limits.callback_payload_max_bytes,
        retry_policy=RetryPolicy(
            config.callback.retry_base_seconds,
            config.callback.retry_max_seconds,
        ),
    )
    worker_id = f"callback-{uuid.uuid4().hex[:8]}"
    while not stop_event.is_set():
        try:
            delivered = dispatcher.deliver_once(worker_id=worker_id)
        except StorageError:
            LOGGER.exception("callback durable-state operation failed")
            stop_event.wait(config.service.callback_poll_interval_seconds)
            continue
        except Exception:
            LOGGER.exception("callback dispatcher failed; retrying loop")
            stop_event.wait(config.service.callback_poll_interval_seconds)
            continue
        if not delivered:
            stop_event.wait(config.service.callback_poll_interval_seconds)


def _readiness(
    storage: Storage,
    disk: DiskPressureController,
    workers: list[BaseProcess],
    callback_thread: threading.Thread | None = None,
) -> tuple[bool, str]:
    if not storage.health_check():
        return False, "storage_unavailable"
    if disk.refresh().intake_paused:
        return False, "disk_pressure"
    if any(not worker.is_alive() for worker in workers):
        return False, "worker_unavailable"
    if callback_thread is not None and not callback_thread.is_alive():
        return False, "callback_unavailable"
    return True, "ready"


def _metrics(
    storage: Storage,
    disk: DiskPressureController,
    workers: list[BaseProcess],
    callback_thread: threading.Thread | None = None,
) -> str:
    disk_status = disk.refresh()
    lines = [
        "# TYPE order_scanner_disk_used_percent gauge",
        f"order_scanner_disk_used_percent {disk_status.used_percent:.6f}",
        "# TYPE order_scanner_intake_paused gauge",
        f"order_scanner_intake_paused {int(disk_status.intake_paused)}",
        "# TYPE order_scanner_workers_alive gauge",
        f"order_scanner_workers_alive {sum(worker.is_alive() for worker in workers)}",
    ]
    if callback_thread is not None:
        lines.append(
            f"order_scanner_callback_thread_alive {int(callback_thread.is_alive())}"
        )
    for name, value in storage.operational_metrics().items():
        lines.append(f"order_scanner_{name} {value:.6f}")
    for state, count in sorted(storage.status_counts().items()):
        lines.append(f'order_scanner_jobs{{state="{state}"}} {count}')
    for state, count in sorted(storage.outbox_counts().items()):
        lines.append(f'order_scanner_outbox{{state="{state}"}} {count}')
    return "\n".join(lines) + "\n"


def _configure_logging(verbose: bool) -> None:
    logging.basicConfig(
        level=logging.DEBUG if verbose else logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s %(message)s",
    )


if __name__ == "__main__":
    sys.exit(main())
