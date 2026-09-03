from pathlib import Path
from shutil import _ntuple_diskusage

import pytest

from order_scanner.runtime import DiskPressureController


def test_disk_pressure_pauses_at_high_and_resumes_below_low(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    usage = {"value": _ntuple_diskusage(total=100, used=85, free=15)}
    monkeypatch.setattr("order_scanner.runtime.shutil.disk_usage", lambda _path: usage["value"])
    controller = DiskPressureController(
        tmp_path,
        high_watermark_percent=80,
        low_watermark_percent=70,
    )
    assert controller.refresh().intake_paused
    usage["value"] = _ntuple_diskusage(total=100, used=75, free=25)
    assert controller.refresh().intake_paused
    usage["value"] = _ntuple_diskusage(total=100, used=69, free=31)
    assert not controller.refresh().intake_paused
