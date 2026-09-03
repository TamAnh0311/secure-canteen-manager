"""Calculate the standard recognition report from frozen labels and predictions."""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path

from order_scanner.benchmark import benchmark_predictions, load_annotations, load_predictions


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--annotations", type=Path, required=True)
    parser.add_argument("--predictions", type=Path, required=True)
    parser.add_argument("--dataset-manifest", type=Path, required=True)
    parser.add_argument("--split", choices=("train", "validation", "test"), default="test")
    parser.add_argument("--model-manifest", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    manifest = _load_manifest(args.model_manifest)
    dataset = _load_dataset_manifest(args.dataset_manifest, args.annotations)
    annotations = load_annotations(args.annotations)
    predictions = load_predictions(args.predictions)
    splits = dataset["splits"]
    if not isinstance(splits, dict) or not isinstance(splits.get(args.split), list):
        raise SystemExit(f"dataset split {args.split} is invalid")
    annotation_ids = {annotation.sample_id for annotation in annotations}
    manifest_ids = {
        str(sample_id)
        for split_ids in splits.values()
        if isinstance(split_ids, list)
        for sample_id in split_ids
    }
    if manifest_ids != annotation_ids:
        raise SystemExit("dataset manifest sample IDs do not match annotations")
    if {prediction.sample_id for prediction in predictions} != annotation_ids:
        raise SystemExit("prediction sample IDs must exactly match annotations")
    writer_sets = {
        split_name: {
            annotation.writer_id
            for annotation in annotations
            if annotation.sample_id in {str(sample_id) for sample_id in split_ids}
        }
        for split_name, split_ids in splits.items()
        if isinstance(split_ids, list)
    }
    split_names = tuple(writer_sets)
    if any(
        writer_sets[left] & writer_sets[right]
        for index, left in enumerate(split_names)
        for right in split_names[index + 1 :]
    ):
        raise SystemExit("dataset manifest writers must be disjoint across splits")
    selected_ids = {str(sample_id) for sample_id in splits[args.split]}
    annotations = tuple(
        annotation for annotation in annotations if annotation.sample_id in selected_ids
    )
    predictions = tuple(
        prediction for prediction in predictions if prediction.sample_id in selected_ids
    )
    if not annotations:
        raise SystemExit(f"dataset split {args.split} contains no annotations")
    report = benchmark_predictions(annotations, predictions).to_dict()
    report["model"] = {
        "model_id": manifest["model_id"],
        "version": manifest["version"],
        "sha256": manifest["sha256"],
        "runtime": manifest["runtime"],
        "precision": manifest["precision"],
        "input_contract": manifest["input_contract"],
        "output_contract": manifest["output_contract"],
        "catalogue_version": manifest.get("catalogue_version"),
        "catalogue_sha256": manifest.get("catalogue_sha256"),
        "thresholds": manifest.get("thresholds"),
        "cpu_requirements": manifest.get("cpu_requirements"),
    }
    report["dataset"] = {
        "manifest": str(args.dataset_manifest),
        "annotations_sha256": dataset["annotations_sha256"],
        "split": args.split,
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(
        json.dumps(report, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )


def _load_manifest(path: Path) -> dict[str, object]:
    value = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(value, dict):
        raise SystemExit("model manifest must be an object")
    required_strings = (
        "schema_version",
        "model_id",
        "version",
        "sha256",
        "runtime",
        "precision",
        "input_contract",
        "output_contract",
        "catalogue_version",
        "catalogue_sha256",
    )
    for key in required_strings:
        if not isinstance(value.get(key), str) or not str(value[key]).strip():
            raise SystemExit(f"model manifest {key} must be a non-empty string")
    digest = str(value["sha256"])
    if len(digest) != 64 or any(character not in "0123456789abcdef" for character in digest):
        raise SystemExit("model manifest sha256 must be lowercase hexadecimal")
    if digest == "0" * 64:
        raise SystemExit("model manifest sha256 must identify a selected model")
    catalogue_digest = str(value["catalogue_sha256"])
    if len(catalogue_digest) != 64 or any(
        character not in "0123456789abcdef" for character in catalogue_digest
    ):
        raise SystemExit("model manifest catalogue_sha256 must be lowercase hexadecimal")
    if catalogue_digest == "0" * 64:
        raise SystemExit("model manifest catalogue_sha256 must identify a catalogue")
    thresholds = value.get("thresholds")
    if not isinstance(thresholds, dict):
        raise SystemExit("model manifest thresholds must be an object")
    for key in ("minimum_item_score", "minimum_candidate_margin"):
        threshold = thresholds.get(key)
        if isinstance(threshold, bool) or not isinstance(threshold, (int, float)):
            raise SystemExit(f"model manifest threshold {key} must be numeric")
        if not 0.0 <= threshold <= 1.0:
            raise SystemExit(f"model manifest threshold {key} must be between 0 and 1")
    if not isinstance(value.get("cpu_requirements"), dict):
        raise SystemExit("model manifest cpu_requirements must be an object")
    return value


def _load_dataset_manifest(path: Path, annotations_path: Path) -> dict[str, object]:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError) as exc:
        raise SystemExit(f"cannot read dataset manifest: {type(exc).__name__}") from None
    if not isinstance(value, dict) or value.get("schema_version") != "order-scanner-dataset-v1":
        raise SystemExit("unsupported dataset manifest schema")
    digest = hashlib.sha256(annotations_path.read_bytes()).hexdigest()
    if value.get("annotations_sha256") != digest:
        raise SystemExit("dataset manifest does not match annotations file")
    splits = value.get("splits")
    if (
        not isinstance(splits, dict)
        or set(splits) != {"train", "validation", "test"}
        or any(
            key not in splits or not isinstance(splits[key], list)
            for key in ("train", "validation", "test")
        )
    ):
        raise SystemExit("dataset manifest splits are invalid")
    seen_ids: set[str] = set()
    for split_name in ("train", "validation", "test"):
        split_ids = splits[split_name]
        if any(not isinstance(sample_id, str) or not sample_id.strip() for sample_id in split_ids):
            raise SystemExit(f"dataset manifest {split_name} IDs must be non-empty strings")
        if len(set(split_ids)) != len(split_ids):
            raise SystemExit(f"dataset manifest {split_name} IDs must be unique")
        if seen_ids & set(split_ids):
            raise SystemExit("dataset manifest splits must be disjoint")
        seen_ids.update(split_ids)
    return value


if __name__ == "__main__":
    main()
