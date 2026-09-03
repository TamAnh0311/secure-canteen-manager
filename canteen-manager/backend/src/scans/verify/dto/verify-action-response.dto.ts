import { SheetStatus } from '../../sheet-status.enum';

export interface ConfirmScanResponseDto {
  replaced: boolean;
}

export interface VerifyActionResponseDto {
  status: SheetStatus;
}

export function toConfirmScanResponse(replaced: boolean): ConfirmScanResponseDto {
  return { replaced };
}

export function toVerifyActionResponse(status: SheetStatus): VerifyActionResponseDto {
  return { status };
}
