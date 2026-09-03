---
name: project-e2e-lifecycle-leaks
description: Two missing onModuleDestroy hooks caused "Driver not Connected" errors and open handle leaks in the NestJS e2e suite — root cause and fix documented
metadata:
  type: project
---

Two lifecycle bugs in the canteen-manager backend caused intermittent e2e failures.

**Why:** NestJS `app.close()` destroys the TypeORM DataSource, but async work queued before shutdown continues running and tries to write to the dead DataSource.

## Root Cause 1 — ScanProcessorService (src/scans/scan-processor.service.ts)

No `onModuleDestroy`. The serial promise-chain tail kept processing sheets after `app.close()`. The recovery e2e test uses a 5 s slow mock; `app.close()` fires at T+200 ms; the mock resolves at T+5 s and tries `repo.save()` → "Driver not Connected".

**Fix:** Added `OnModuleDestroy` that sets `shutdownRequested = true`. Added a guard at the top of `processSheet()` AND immediately after the `omrClient.processScan()` await (the only long-running await that spans the shutdown window), so in-flight work returns early instead of hitting the closed DataSource. Sheets left mid-processing are recovered by the next boot's `onApplicationBootstrap` sweep — the designed recovery path.

## Root Cause 2 — LegacySyncService (src/legacy-sync/legacy-sync.service.ts)

No `onModuleDestroy`. `CronJob` from the `cron` package holds a `setInterval`-like timer. When each spec's `app.close()` ran, the timer was never stopped, keeping the Node.js event loop alive. With 5 spec files each booting AppModule, 5 leaked timers accumulated → Jest reported "Jest did not exit" and required `--forceExit` to kill the process.

**Fix:** Added `OnModuleDestroy` that calls `job.stop()` then `schedulerRegistry.deleteCronJob('legacy-sync')`, wrapped in try/catch for the case where `onModuleInit()` failed to register the job (invalid cron expression).

## Verification

- `Driver not Connected` error: eliminated from all runs
- Jest exits cleanly without `--forceExit`
- 3 consecutive full-suite passes: `Tests: 1 skipped, 60 passed, 61 total`
- scan+legacy-sync pair: `Tests: 1 skipped, 25 passed, 26 total`
- scan alone: `Tests: 21 passed, 21 total`

**How to apply:** If new services register timers, cron jobs, or background async chains, always implement `onModuleDestroy` to release them. Check all long-running awaits in background workers for post-shutdown DB writes.
