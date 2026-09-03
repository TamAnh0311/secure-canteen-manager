import { HttpException, HttpStatus, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { statfsSync } from 'fs';
import { In, Repository } from 'typeorm';
import { AppEnv } from '../config/env-validation';
import { Sheet } from './sheet.entity';
import { SheetStatus } from './sheet-status.enum';

@Injectable()
export class ScanAdmissionService {
  private readonly active = new Map<string, number>();
  private readonly recent = new Map<string, number[]>();
  private readonly credentialLocks = new Map<string, Promise<void>>();
  private inFlightPendingReservations = 0;
  private pendingChecksInProgress = 0;
  private deferredPendingReleases = 0;

  constructor(
    @InjectRepository(Sheet) private readonly sheets: Repository<Sheet>,
    private readonly config: ConfigService<AppEnv, true>,
  ) {}

  async enter(credentialId: string): Promise<() => void> {
    return this.withCredentialLock(credentialId, () => this.enterLocked(credentialId));
  }

  private async enterLocked(credentialId: string): Promise<() => void> {
    const now = Date.now();
    const windowStart = now - 60_000;
    const calls = (this.recent.get(credentialId) ?? []).filter((at) => at >= windowStart);
    if (calls.length >= this.config.get('SCAN_RATE_LIMIT_PER_MINUTE', { infer: true })) {
      throw new HttpException({ message: 'Scan upload rate exceeded', code: 'SCAN.RATE_LIMITED' }, HttpStatus.TOO_MANY_REQUESTS);
    }
    if ((this.active.get(credentialId) ?? 0) >= this.config.get('SCAN_MAX_CONCURRENT_PER_CREDENTIAL', { infer: true })) {
      throw new HttpException({ message: 'Too many concurrent scan uploads', code: 'SCAN.CONCURRENCY_LIMITED' }, HttpStatus.TOO_MANY_REQUESTS);
    }
    const releasePending = await this.reservePendingSlot();
    try {
      const storageDir = this.config.get('SCAN_STORAGE_DIR', { infer: true });
      const fsState = statfsSync(storageDir);
      const usedRatio = fsState.blocks === 0 ? 1 : 1 - Number(fsState.bavail) / Number(fsState.blocks);
      if (usedRatio >= this.config.get('SCAN_STORAGE_HIGH_WATERMARK', { infer: true })) {
        throw new ServiceUnavailableException({ message: 'Scan storage is full', code: 'SCAN.STORAGE_HIGH_WATERMARK' });
      }

      calls.push(now);
      this.recent.set(credentialId, calls);
      this.active.set(credentialId, (this.active.get(credentialId) ?? 0) + 1);
      let released = false;
      return () => {
        if (released) return;
        released = true;
        releasePending();
        const remaining = Math.max(0, (this.active.get(credentialId) ?? 0) - 1);
        if (remaining === 0) {
          this.active.delete(credentialId);
        } else {
          this.active.set(credentialId, remaining);
        }
      };
    } catch (error) {
      releasePending();
      throw error;
    }
  }

  private async reservePendingSlot(): Promise<() => void> {
    // These synchronous mutations are the short global atomic section. Counts remain
    // concurrent, but every candidate is represented while its snapshot is in flight.
    this.pendingChecksInProgress += 1;
    this.inFlightPendingReservations += 1;
    let reservationHeld = true;
    try {
      const pending = await this.sheets.count({
        where: { status: In([SheetStatus.PENDING, SheetStatus.PROCESSING]) },
      });
      const maxPending = this.config.get('SCAN_MAX_PENDING', { infer: true });
      if (pending + this.inFlightPendingReservations > maxPending) {
        this.inFlightPendingReservations -= 1;
        reservationHeld = false;
        throw new ServiceUnavailableException({ message: 'Scan queue is full', code: 'SCAN.QUEUE_FULL' });
      }

      let released = false;
      return () => {
        if (released) return;
        released = true;
        if (this.pendingChecksInProgress > 0) {
          // The DB row represented by this reservation may have committed after an
          // overlapping count took its snapshot. Keep it represented until all such
          // snapshots have made their admission decision.
          this.deferredPendingReleases += 1;
        } else {
          this.inFlightPendingReservations = Math.max(0, this.inFlightPendingReservations - 1);
        }
      };
    } catch (error) {
      if (reservationHeld) {
        this.inFlightPendingReservations = Math.max(0, this.inFlightPendingReservations - 1);
      }
      throw error;
    } finally {
      this.pendingChecksInProgress -= 1;
      if (this.pendingChecksInProgress === 0 && this.deferredPendingReleases > 0) {
        this.inFlightPendingReservations = Math.max(
          0,
          this.inFlightPendingReservations - this.deferredPendingReleases,
        );
        this.deferredPendingReleases = 0;
      }
    }
  }

  private async withCredentialLock<T>(credentialId: string, work: () => Promise<T>): Promise<T> {
    const previous = this.credentialLocks.get(credentialId) ?? Promise.resolve();
    let unlock!: () => void;
    const current = new Promise<void>((resolve) => {
      unlock = resolve;
    });
    this.credentialLocks.set(credentialId, current);

    await previous;
    try {
      return await work();
    } finally {
      unlock();
      if (this.credentialLocks.get(credentialId) === current) {
        this.credentialLocks.delete(credentialId);
      }
    }
  }

}
