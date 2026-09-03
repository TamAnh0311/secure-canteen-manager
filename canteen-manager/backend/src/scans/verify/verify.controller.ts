import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import { IsOptional, IsDateString, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';
import { Response } from 'express';
import { VerifyService } from './verify.service';
import { ConfirmScanDto } from './dto/confirm-scan.dto';
import { VerifyQueueResponse } from './verify-queue.assembler';
import { OperatorPublic } from '../../operators/operator-public';
import { Roles } from '../../auth/roles.decorator';
import { OperatorRole } from '../../operators/operator.entity';
import {
  ConfirmScanResponseDto,
  toConfirmScanResponse,
  toVerifyActionResponse,
  VerifyActionResponseDto,
} from './dto/verify-action-response.dto';

interface AuthRequest {
  user: OperatorPublic;
}

// Optional inclusive service_date range for the verify queue. Omitted → service defaults to today.
class VerifyQueueQueryDto {
  @IsOptional()
  @IsDateString({}, { message: 'VALIDATION.DATE_FROM_ISO' })
  dateFrom?: string;

  @IsOptional()
  @IsDateString({}, { message: 'VALIDATION.DATE_TO_ISO' })
  dateTo?: string;
}

class CandidateSearchQueryDto {
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  q!: string;
}

class IdentityPreviewQueryDto {
  @IsUUID('4')
  userId!: string;
}

@Controller('scans/verify')
@Roles(OperatorRole.OPERATOR, OperatorRole.ADMIN)
export class VerifyController {
  constructor(private readonly verifyService: VerifyService) {}

  @Get('queue')
  getQueue(
    @Query() query: VerifyQueueQueryDto,
    @Req() req: AuthRequest,
  ): Promise<VerifyQueueResponse> {
    return this.verifyService.getQueue(req.user, query.dateFrom, query.dateTo);
  }

  // Serves the warped (perspective-corrected) PNG for the operator verify screen.
  // Lazy: caches the warped result on first request; subsequent requests are served
  // from disk. Falls back to the raw PNG/JPEG with X-Warp-Ok: false on any warp error.
  @Get(':id/warped-image')
  async getWarpedImage(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: AuthRequest,
    @Res() res: Response,
  ): Promise<void> {
    const { imageBytes, warpOk, contentType } = await this.verifyService.getWarpedImage(id, req.user);
    res.setHeader('Content-Type', contentType);
    res.setHeader('X-Warp-Ok', warpOk ? 'true' : 'false');
    res.setHeader('Cache-Control', 'private, max-age=3600');
    res.end(imageBytes);
  }

  @Get(':id/artifacts/:artifactId')
  async getScannerArtifact(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('artifactId') artifactId: string,
    @Req() req: AuthRequest,
    @Res() res: Response,
  ): Promise<void> {
    const { imageBytes, contentType } = await this.verifyService.getScannerArtifact(
      id,
      artifactId,
      req.user,
    );
    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'private, max-age=3600');
    res.end(imageBytes);
  }

  @Post(':id/artifacts/:artifactId/retry')
  @HttpCode(200)
  retryScannerArtifact(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('artifactId') artifactId: string,
    @Req() req: AuthRequest,
  ): Promise<{ state: string }> {
    return this.verifyService.retryScannerArtifact(id, artifactId, req.user);
  }

  @Get(':id/candidates')
  searchCandidates(
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: CandidateSearchQueryDto,
    @Req() req: AuthRequest,
  ) {
    return this.verifyService.searchIdentityCandidates(id, query.q, req.user);
  }

  @Get(':id/identity-preview')
  identityPreview(
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: IdentityPreviewQueryDto,
    @Req() req: AuthRequest,
  ) {
    return this.verifyService.getIdentityPreview(id, query.userId, req.user);
  }

  @Post(':id/confirm')
  async confirm(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ConfirmScanDto,
    @Req() req: AuthRequest,
  ): Promise<ConfirmScanResponseDto> {
    const result = await this.verifyService.confirm(id, dto, req.user);
    return toConfirmScanResponse(result.replaced);
  }

  @Post(':id/reject')
  @HttpCode(200)
  async reject(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: AuthRequest,
  ): Promise<VerifyActionResponseDto> {
    const sheet = await this.verifyService.reject(id, req.user);
    return toVerifyActionResponse(sheet.status);
  }

  @Post(':id/skip')
  @HttpCode(200)
  async skip(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: AuthRequest,
  ): Promise<VerifyActionResponseDto> {
    const sheet = await this.verifyService.skip(id, req.user);
    return toVerifyActionResponse(sheet.status);
  }
}
