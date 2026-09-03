"""Small runtime controls shared by intake, health, and metrics."""

from __future__ import annotations

import shutil
from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True, slots=True)
class DiskStatus:
    total_bytes: int
    used_bytes: int
    free_bytes: int
    used_percent: float
    intake_paused: bool


class DiskPressureController:
    def __init__(
        self,
        path: str | Path,
        *,
        high_watermark_percent: int,
        low_watermark_percent: int,
    ) -> None:
        if not 1 <= low_watermark_percent < high_watermark_percent < 100:
            raise ValueError("disk watermarks must satisfy 1 <= low < high < 100")
        self.path = Path(path)
        self.high = high_watermark_percent
        self.low = low_watermark_percent
        self._paused = False

    def refresh(self) -> DiskStatus:
        usage = shutil.disk_usage(self.path)
        used_percent = usage.used * 100 / max(usage.total, 1)
        if self._paused:
            if used_percent <= self.low:
                self._paused = False
        elif used_percent >= self.high:
            self._paused = True
        return DiskStatus(
            total_bytes=usage.total,
            used_bytes=usage.used,
            free_bytes=usage.free,
            used_percent=used_percent,
            intake_paused=self._paused,
        )

    @property
    def intake_allowed(self) -> bool:
        return not self._paused
