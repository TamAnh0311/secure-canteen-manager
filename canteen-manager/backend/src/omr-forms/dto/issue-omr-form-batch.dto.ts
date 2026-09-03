import { Transform } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, ArrayUnique, IsArray, IsEnum, IsUUID } from 'class-validator';
import { OmrFormMode } from '../omr-form-template.entity';

export const MAX_OMR_BATCH_SIZE = 50;

export class IssueOmrFormBatchDto {
  @Transform(({ value }) =>
    Array.isArray(value)
      ? value.map((entry) => typeof entry === 'string' ? entry.toLowerCase() : entry)
      : value)
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_OMR_BATCH_SIZE)
  @ArrayUnique()
  @IsUUID('all', { each: true })
  userIds!: string[];

  @IsEnum(OmrFormMode)
  mode!: OmrFormMode;
}
