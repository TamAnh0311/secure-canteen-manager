import { Body, Controller, Get, Param, Post, Query, Request } from '@nestjs/common';
import { Roles } from '../auth/roles.decorator';
import { OperatorRole } from '../operators/operator.entity';
import { OperatorPublic } from '../operators/operator-public';
import { IssueOmrFormDto } from './dto/issue-omr-form.dto';
import { IssueOmrFormBatchDto } from './dto/issue-omr-form-batch.dto';
import { ListOmrFormRosterDto } from './dto/list-omr-form-roster.dto';
import { IssuedOmrFormBatchPrint, IssuedOmrFormPrint, OmrFormsService } from './omr-forms.service';

@Controller('omr-forms')
export class OmrFormsController {
  constructor(private readonly omrFormsService: OmrFormsService) {}

  @Post()
  @Roles(OperatorRole.OPERATOR, OperatorRole.ADMIN)
  issue(
    @Body() dto: IssueOmrFormDto,
    @Request() req: { user: OperatorPublic },
  ): Promise<IssuedOmrFormPrint> {
    return this.omrFormsService.issue(dto.userId, req.user);
  }

  @Get('roster/options')
  @Roles(OperatorRole.OPERATOR, OperatorRole.ADMIN)
  rosterOptions(@Request() req: { user: OperatorPublic }) {
    return this.omrFormsService.listRosterOptions(req.user);
  }

  @Get('roster')
  @Roles(OperatorRole.OPERATOR, OperatorRole.ADMIN)
  roster(
    @Query() dto: ListOmrFormRosterDto,
    @Request() req: { user: OperatorPublic },
  ) {
    return this.omrFormsService.listRoster(req.user, dto.zone, dto.cell ?? null);
  }

  @Get('capabilities')
  @Roles(OperatorRole.OPERATOR, OperatorRole.ADMIN)
  capabilities() {
    return this.omrFormsService.getCapabilities();
  }

  @Post('batch')
  @Roles(OperatorRole.OPERATOR, OperatorRole.ADMIN)
  issueBatch(
    @Body() dto: IssueOmrFormBatchDto,
    @Request() req: { user: OperatorPublic },
  ): Promise<IssuedOmrFormBatchPrint> {
    return this.omrFormsService.issueBatch(dto, req.user);
  }

  @Get('masters/:mode')
  @Roles(OperatorRole.OPERATOR, OperatorRole.ADMIN)
  genericMaster(@Param('mode') mode: string) {
    return this.omrFormsService.getGenericMaster(mode as IssueOmrFormBatchDto['mode']);
  }
}
