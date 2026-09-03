import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
  Req,
} from '@nestjs/common';
import { IsOptional, IsDateString } from 'class-validator';
import { ScansService } from './scans.service';
import { DemoScanService } from './demo-scan.service';
import { ScanAuthGuard } from './scan-auth.guard';
import { Public } from '../auth/public.decorator';
import { SubmitScanDto } from './dto/submit-scan.dto';
import { GenerateDemoRecordDto } from './dto/generate-demo-record.dto';
import { ListScansDto } from './dto/list-scans.dto';
import { Sheet } from './sheet.entity';
import { Roles } from '../auth/roles.decorator';
import { OperatorRole } from '../operators/operator.entity';
import { ScanResponseDto, toScanResponse } from './dto/scan-response.dto';
import { Request } from 'express';
import { OperatorPublic } from '../operators/operator-public';

// Optional inclusive service_date range for the KPI route. Omitted → service defaults to today.
class KpiQueryDto {
  @IsOptional()
  @IsDateString({}, { message: 'VALIDATION.DATE_FROM_ISO' })
  dateFrom?: string;

  @IsOptional()
  @IsDateString({}, { message: 'VALIDATION.DATE_TO_ISO' })
  dateTo?: string;
}

@Controller('scans')
export class ScansController {
  constructor(
    private readonly scansService: ScansService,
    private readonly demoScanService: DemoScanService,
  ) {}

  // Marked @Public to bypass the global JwtAuthGuard; ScanAuthGuard replaces it,
  // accepting either an agent token or a valid operator JWT.
  @Post()
  @Public()
  @UseGuards(ScanAuthGuard)
  @HttpCode(202)
  async submit(
    @Body() dto: SubmitScanDto,
    @Req() req: Request & { scanCredentialId?: string },
  ): Promise<{ id: string; sheetId: string; status: string }> {
    const sheet = await this.scansService.submit({
      sheetId: dto.sheetId,
      batch: dto.batch,
      checksum: dto.checksum,
      imageBase64: dto.imageBase64,
      credentialId: req.scanCredentialId,
    });
    return { id: sheet.id, sheetId: sheet.sheetId, status: sheet.status };
  }

  // Fabricates a synthetic flagged OMR sheet (reusing the embedded demo scan image)
  // against the global menu, dated to the next collection day, so Verify can be demoed without a
  // scanner or the omr-service. Operator JWT required (global guard, not @Public).
  @Post('demo')
  @Roles(OperatorRole.OPERATOR, OperatorRole.ADMIN)
  @HttpCode(202)
  async generateDemo(
    @Body() _dto: GenerateDemoRecordDto,
    @Req() req: Request & { user: OperatorPublic },
  ): Promise<{ id: string; sheetId: string; status: string }> {
    const sheet = await this.demoScanService.createDemoRecord(req.user);
    return { id: sheet.id, sheetId: sheet.sheetId, status: sheet.status };
  }

  // KPI route must come before :id to avoid ParseUUIDPipe matching 'kpi' as a UUID
  @Get('kpi')
  @Roles(OperatorRole.OPERATOR, OperatorRole.ADMIN)
  async kpi(
    @Query() query: KpiQueryDto,
    @Req() req: Request & { user: OperatorPublic },
  ): Promise<Record<string, number>> {
    return this.scansService.getKpi(req.user, query.dateFrom, query.dateTo);
  }

  @Get()
  @Roles(OperatorRole.OPERATOR, OperatorRole.ADMIN)
  async findAll(
    @Query() query: ListScansDto,
    @Req() req: Request & { user: OperatorPublic },
  ): Promise<ScanResponseDto[]> {
    const sheets = await this.scansService.findAll({
      dateFrom: query.dateFrom,
      dateTo: query.dateTo,
      status: query.status,
      limit: query.limit,
      offset: query.offset,
    }, req.user);
    return sheets.map(toScanResponse);
  }

  @Get(':id')
  @Roles(OperatorRole.OPERATOR, OperatorRole.ADMIN)
  async findOne(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: Request & { user: OperatorPublic },
  ): Promise<ScanResponseDto> {
    return toScanResponse(await this.scansService.findOne(id, req.user));
  }
}
