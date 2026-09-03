"""Validate scanner files through decode, alignment, and crop extraction in temporary state."""

from __future__ import annotations

import argparse
import json
import tempfile
from pathlib import Path

from order_scanner.artifacts import ImmutableFileStore
from order_scanner.config import LimitConfig, ScannerConfig
from order_scanner.ingestion import (
    Candidate,
    IngestionError,
    IngestionService,
    ScannerInbox,
)
from order_scanner.storage import Storage


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--inbox", type=Path, default=Path("scanner-inbox"))
    parser.add_argument("--pdf-dpi", type=int, default=150)
    parser.add_argument(
        "--output",
        type=Path,
        help="keep the validation database, spool, crops, and summary in a new directory",
    )
    args = parser.parse_args()
    scanner = ScannerConfig(pdf_dpi=args.pdf_dpi)
    if args.output is None:
        with tempfile.TemporaryDirectory(
            prefix="order-scanner-inbox-validation-"
        ) as directory:
            results = _run_validation(args.inbox, scanner, Path(directory))
    else:
        if args.output.exists():
            parser.error("--output must name a new directory")
        args.output.mkdir(parents=True)
        results = _run_validation(args.inbox, scanner, args.output)
        (args.output / "summary.json").write_text(
            json.dumps(results, indent=2, sort_keys=True) + "\n",
            encoding="utf-8",
        )
    print(json.dumps(results, indent=2, sort_keys=True))


def _run_validation(
    inbox: Path, scanner: ScannerConfig, root: Path
) -> list[dict[str, object]]:
    storage = Storage(root / "state.sqlite3", artifact_root=root / "artifacts")
    storage.migrate(Path(__file__).resolve().parents[1] / "migrations")
    service = IngestionService(
        inbox=ScannerInbox(inbox, scanner),
        source_store=ImmutableFileStore(root / "spool"),
        artifact_store=ImmutableFileStore(root / "artifacts"),
        storage=storage,
        limits=LimitConfig(),
        scanner=scanner,
        bundle_fingerprint="c" * 64,
    )
    return [_validate(service, candidate) for candidate in service.inbox.candidates()]


def _validate(service: IngestionService, candidate: Candidate) -> dict[str, object]:
    try:
        result = service.ingest(candidate)
    except IngestionError as exc:
        return {
            "file": candidate.relative_path,
            "status": "rejected",
            "reason": exc.reason_code,
            "detail": str(exc),
        }
    return {
        "file": candidate.relative_path,
        "status": "processed",
        "pages": len(result.pages),
        "dispositions": [alignment.disposition.value for alignment in result.alignments],
        "reasons": [alignment.reason_code for alignment in result.alignments],
        "crop_count": len(result.crop_artifacts),
    }


if __name__ == "__main__":
    main()
