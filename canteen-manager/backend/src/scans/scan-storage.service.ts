import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppEnv } from '../config/env-validation';
import { createHash } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { ScanImageFormat } from './scan-image-validator.service';

export const SCAN_STORAGE_RECONCILIATION_GRACE_MS = 24 * 60 * 60 * 1000;
const STORAGE_IMAGE_KEY = '(?:[a-f0-9]{64}|[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12})';
const RAW_IMAGE_NAME = new RegExp(`^${STORAGE_IMAGE_KEY}\\.(?:jpg|png)$`);
const STAGED_IMAGE_NAME = new RegExp(
  `^\\.${STORAGE_IMAGE_KEY}\\.(?:jpg|png)\\.\\d+\\.\\d+\\.stage$`,
);
const SCANNER_ARTIFACT_NAME = /^[a-f0-9]{64}-[a-f0-9]{64}\.bin$/;
const SCANNER_ARTIFACT_STAGE_NAME = /^\.[a-f0-9]{64}-[a-f0-9]{64}\.bin\.\d+\.\d+\.stage$/;

export function projectedStorageUseRatio(
  blocks: number,
  availableBlocks: number,
  blockSize: number,
  additionalBytes: number,
): number {
  if (blocks <= 0) return 1;
  const additionalBlocks = Math.ceil(Math.max(0, additionalBytes) / Math.max(1, blockSize));
  return 1 - (availableBlocks - additionalBlocks) / blocks;
}

export class ScanStorageCapacityError extends Error {
  constructor() {
    super('Scan storage high watermark reached');
  }
}

@Injectable()
export class ScanStorageService {
  private readonly logger = new Logger(ScanStorageService.name);
  private readonly storageDir: string;

  constructor(private readonly config: ConfigService<AppEnv, true>) {
    this.storageDir = this.config.get('SCAN_STORAGE_DIR', { infer: true });
    this.ensureDir();
  }

  // Writes base64-encoded image to disk using the checksum as filename.
  // Returns the relative path stored in the DB (portable across storage dir renames).
  async saveImage(checksum: string, bytes: Buffer, format: ScanImageFormat): Promise<string> {
    this.ensureDir();
    const filename = `${checksum}${format === 'png' ? '.png' : '.jpg'}`;
    const fullPath = this.resolveWithin(filename);
    if (!fs.existsSync(fullPath)) {
      const staged = this.resolveWithin(`.${filename}.${process.pid}.${Date.now()}.stage`);
      try {
        fs.writeFileSync(staged, bytes, { mode: 0o600, flag: 'wx' });
        fs.renameSync(staged, fullPath);
      } finally {
        if (fs.existsSync(staged)) fs.unlinkSync(staged);
      }
    } else {
      // A racing submit may reuse a checksum final written by an earlier failed request.
      // Refresh its activity timestamp so conservative orphan cleanup cannot remove it
      // while this request may still commit the authoritative Sheet row.
      const now = new Date();
      fs.utimesSync(fullPath, now, now);
    }
    return filename;
  }

  reconcileOrphans(referencedPaths: ReadonlySet<string>, now = new Date()): number {
    this.ensureDir();
    const staleBefore = now.getTime() - SCAN_STORAGE_RECONCILIATION_GRACE_MS;
    let removed = 0;

    for (const entry of fs.readdirSync(this.storageDir, { withFileTypes: true })) {
      if (!entry.isFile()) continue;
      const isStage = STAGED_IMAGE_NAME.test(entry.name);
      const isRaw = RAW_IMAGE_NAME.test(entry.name);
      if ((!isStage && !isRaw) || (isRaw && referencedPaths.has(entry.name))) continue;

      const fullPath = this.resolveWithin(entry.name);
      let stat: fs.Stats;
      try {
        stat = fs.statSync(fullPath);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue;
        throw error;
      }
      if (stat.mtimeMs > staleBefore) continue;

      try {
        fs.unlinkSync(fullPath);
        removed += 1;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
    }

    const scannerDir = path.join(this.storageDir, 'scanner-artifacts');
    if (fs.existsSync(scannerDir)) {
      for (const entry of fs.readdirSync(scannerDir, { withFileTypes: true })) {
        if (!entry.isFile() || (!SCANNER_ARTIFACT_NAME.test(entry.name) && !SCANNER_ARTIFACT_STAGE_NAME.test(entry.name))) continue;
        const relativePath = path.join('scanner-artifacts', entry.name);
        if (referencedPaths.has(relativePath)) continue;
        const fullPath = this.resolveWithin(relativePath);
        let stat: fs.Stats;
        try {
          stat = fs.statSync(fullPath);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue;
          throw error;
        }
        if (stat.mtimeMs > staleBefore) continue;
        try {
          fs.unlinkSync(fullPath);
          removed += 1;
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        }
      }
    }

    return removed;
  }

  deleteImage(relativePath: string): void {
    const fullPath = this.resolveWithin(relativePath);
    if (fs.existsSync(fullPath)) fs.unlinkSync(fullPath);
  }

  deleteWarpedImages(sheetId: string): void {
    const warpedDir = path.join(this.storageDir, 'warped');
    if (!fs.existsSync(warpedDir)) return;
    const prefix = `${this.safeCachePart(sheetId)}__`;
    for (const name of fs.readdirSync(warpedDir)) {
      if (name.startsWith(prefix) && name.endsWith('.png')) {
        const relativePath = path.join('warped', name);
        const fullPath = this.resolveWithin(relativePath);
        if (fs.existsSync(fullPath)) fs.unlinkSync(fullPath);
      }
    }
  }

  // Reads the image file and returns it as a base64 string for forwarding to OMR service.
  readImageAsBase64(relativePath: string): string {
    const fullPath = this.resolveWithin(relativePath);
    const buf = fs.readFileSync(fullPath);
    return buf.toString('base64');
  }

  // Reads the image file and returns the raw Buffer.
  readImageBytes(relativePath: string): Buffer {
    const fullPath = this.resolveWithin(relativePath);
    return fs.readFileSync(fullPath);
  }

  // Promotes a verified scanner artifact atomically into a private subdirectory.
  // Hashing both contract identifiers keeps valid IDs with path separators out of filenames.
  saveScannerArtifact(eventId: string, artifactId: string, bytes: Buffer): string {
    if (!eventId || !artifactId) throw new Error('Scanner artifact identifiers are required');
    const highWatermark = this.config.get('SCAN_STORAGE_HIGH_WATERMARK', { infer: true });
    if (typeof highWatermark === 'number') {
      const fsState = fs.statfsSync(this.storageDir);
      const projected = projectedStorageUseRatio(
        Number(fsState.blocks),
        Number(fsState.bavail),
        Number(fsState.bsize),
        bytes.length,
      );
      if (projected >= highWatermark) throw new ScanStorageCapacityError();
    }
    const eventKey = createHash('sha256').update(eventId, 'utf8').digest('hex');
    const artifactKey = createHash('sha256').update(artifactId, 'utf8').digest('hex');
    const filename = `${eventKey}-${artifactKey}.bin`;
    const relativePath = path.join('scanner-artifacts', filename);
    const directory = path.join(this.storageDir, 'scanner-artifacts');
    if (!fs.existsSync(directory)) fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
    const fullPath = this.resolveWithin(relativePath);
    const staged = this.resolveWithin(`scanner-artifacts/.${filename}.${process.pid}.${Date.now()}.stage`);
    fs.writeFileSync(staged, bytes, { mode: 0o600, flag: 'wx' });
    try {
      fs.renameSync(staged, fullPath);
    } finally {
      if (fs.existsSync(staged)) fs.unlinkSync(staged);
    }
    return relativePath;
  }

  // Saves a warped PNG under warped/<sheetId>__<roiVersion>.png.
  // Returns the relative path for use as a cache key.
  async saveWarpedImage(
    sheetId: string,
    imageBase64: string,
    roiVersion: string | null,
  ): Promise<string> {
    const warpedDir = path.join(this.storageDir, 'warped');
    if (!fs.existsSync(warpedDir)) {
      fs.mkdirSync(warpedDir, { recursive: true, mode: 0o700 });
    }
    const relativePath = this.warpedRelativePath(sheetId, roiVersion);
    const fullPath = this.resolveWithin(relativePath);
    const buf = Buffer.from(imageBase64, 'base64');
    fs.writeFileSync(fullPath, buf, { mode: 0o600 });
    return relativePath;
  }

  // Returns true when a warped cache file exists for this (sheet, roiVersion).
  warpedImageExists(sheetId: string, roiVersion: string | null): boolean {
    try {
      const fullPath = this.resolveWithin(this.warpedRelativePath(sheetId, roiVersion));
      return fs.existsSync(fullPath);
    } catch {
      return false;
    }
  }

  // Returns the relative path for the cached warped image (caller must verify existence first).
  warpedImagePath(sheetId: string, roiVersion: string | null): string {
    return this.warpedRelativePath(sheetId, roiVersion);
  }

  // Cache key folds roiVersion into the filename so a regenerated ROI never serves
  // a stale warp from a prior layout. roiVersion is sanitised to filename-safe chars.
  private warpedRelativePath(sheetId: string, roiVersion: string | null): string {
    const safeVersion = this.safeCachePart(roiVersion ?? 'none');
    return path.join('warped', `${this.safeCachePart(sheetId)}__${safeVersion}.png`);
  }

  private safeCachePart(value: string): string {
    return value.replace(/[^a-zA-Z0-9._-]/g, '_');
  }

  // Resolves a filename under the storage dir and asserts it cannot escape it.
  // Defense-in-depth even though the checksum DTO is already format-constrained:
  // the storage layer must never trust its caller to hand it a contained name.
  private resolveWithin(relativeName: string): string {
    const base = path.resolve(this.storageDir);
    const full = path.resolve(base, relativeName);
    if (full !== base && !full.startsWith(base + path.sep)) {
      throw new Error('Resolved scan path escapes storage directory');
    }
    return full;
  }

  private ensureDir(): void {
    if (!fs.existsSync(this.storageDir)) {
      // 0700 = owner only — prevents other OS users from listing scan images
      fs.mkdirSync(this.storageDir, { recursive: true, mode: 0o700 });
      this.logger.log(`Created scan storage directory: ${this.storageDir}`);
    }
  }
}
