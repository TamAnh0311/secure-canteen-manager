import { IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';

export class SubmitScanDto {
  @IsString({ message: 'VALIDATION.SHEET_ID_STRING' })
  @MinLength(1, { message: 'VALIDATION.SHEET_ID_REQUIRED' })
  @MaxLength(100, { message: 'VALIDATION.SHEET_ID_MAX' })
  sheetId!: string;

  @IsOptional()
  @IsString({ message: 'VALIDATION.BATCH_STRING' })
  @MaxLength(100, { message: 'VALIDATION.BATCH_MAX' })
  batch?: string;

  // SHA-256 hex digest of the raw image bytes. Constrained to 64 lowercase hex
  // chars because this value is used verbatim as the on-disk image filename —
  // a free-form string would allow path traversal (e.g. "../../etc/x").
  @IsString({ message: 'VALIDATION.CHECKSUM_STRING' })
  @Matches(/^[a-f0-9]{64}$/, { message: 'VALIDATION.CHECKSUM_FORMAT' })
  checksum!: string;

  @IsString({ message: 'VALIDATION.IMAGE_BASE64_STRING' })
  @MinLength(1, { message: 'VALIDATION.IMAGE_BASE64_REQUIRED' })
  imageBase64!: string;
}
