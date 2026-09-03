import { Body, Controller, Get, Param, Patch, Post, ParseUUIDPipe } from '@nestjs/common';
import { OperatorsService } from './operators.service';
import { CreateOperatorDto } from './dto/create-operator.dto';
import { UpdateOperatorZoneDto } from './dto/update-operator-zone.dto';
import { Roles } from '../auth/roles.decorator';
import { OperatorRole } from './operator.entity';
import { OperatorPublic } from '../auth/auth.service';

@Controller('operators')
@Roles(OperatorRole.ADMIN)
export class OperatorsController {
  constructor(private readonly operatorsService: OperatorsService) {}

  @Post()
  create(@Body() dto: CreateOperatorDto): Promise<OperatorPublic> {
    return this.operatorsService.create(dto);
  }

  @Get()
  findAll(): Promise<OperatorPublic[]> {
    return this.operatorsService.findAll();
  }

  @Patch(':id/deactivate')
  deactivate(@Param('id', ParseUUIDPipe) id: string): Promise<OperatorPublic> {
    return this.operatorsService.deactivate(id);
  }

  @Patch(':id/zone')
  updateZone(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateOperatorZoneDto,
  ): Promise<OperatorPublic> {
    return this.operatorsService.updateZone(id, dto.zone ?? null);
  }
}
