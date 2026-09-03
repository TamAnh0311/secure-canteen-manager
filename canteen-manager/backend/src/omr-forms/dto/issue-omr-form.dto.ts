import { IsUUID } from 'class-validator';

export class IssueOmrFormDto {
  @IsUUID()
  userId!: string;
}
