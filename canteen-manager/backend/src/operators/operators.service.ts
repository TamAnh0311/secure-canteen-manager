import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as bcrypt from 'bcrypt';
import { Operator } from './operator.entity';
import { OperatorRole } from './operator.entity';
import { CreateOperatorDto } from './dto/create-operator.dto';
import { OperatorPublic, toOperatorPublic, BCRYPT_COST } from './operator-public';
import { normalizeZone } from '../common/zone-normalization';

@Injectable()
export class OperatorsService {
  private readonly logger = new Logger(OperatorsService.name);

  constructor(
    @InjectRepository(Operator)
    private readonly repo: Repository<Operator>,
  ) {}

  async create(dto: CreateOperatorDto): Promise<OperatorPublic> {
    const existing = await this.repo.findOne({ where: { username: dto.username } });
    if (existing) {
      throw new ConflictException({ message: 'Username already taken', code: 'OPERATOR.USERNAME_TAKEN' });
    }

    const zone = normalizeZone(dto.zone);
    if (dto.role === OperatorRole.OPERATOR && !zone) {
      throw new BadRequestException({
        message: 'An operator zone is required',
        code: 'OPERATOR.ZONE_REQUIRED',
      });
    }
    const passwordHash = await bcrypt.hash(dto.password, BCRYPT_COST);
    const operator = this.repo.create({
      username: dto.username,
      passwordHash,
      displayName: dto.displayName,
      role: dto.role,
      zone: dto.role === OperatorRole.OPERATOR ? zone : null,
    });

    const saved = await this.repo.save(operator);
    return toOperatorPublic(saved);
  }

  async findAll(): Promise<OperatorPublic[]> {
    const operators = await this.repo.find({ order: { createdAt: 'ASC' } });
    return operators.map(toOperatorPublic);
  }

  async deactivate(id: string): Promise<OperatorPublic> {
    const operator = await this.repo.findOne({ where: { id } });
    if (!operator) {
      throw new NotFoundException({ message: 'Operator not found', code: 'OPERATOR.NOT_FOUND' });
    }
    operator.isActive = false;
    const saved = await this.repo.save(operator);
    return toOperatorPublic(saved);
  }

  async updateZone(id: string, value: string | null): Promise<OperatorPublic> {
    const operator = await this.repo.findOne({ where: { id } });
    if (!operator) {
      throw new NotFoundException({ message: 'Operator not found', code: 'OPERATOR.NOT_FOUND' });
    }
    const previousZone = operator.zone;
    operator.zone = operator.role === OperatorRole.OPERATOR ? normalizeZone(value) : null;
    const saved = await this.repo.save(operator);
    this.logger.log(
      `Operator zone updated operatorId=${operator.id} oldZone=${previousZone ?? '[unassigned]'} newZone=${saved.zone ?? '[unassigned]'}`,
    );
    return toOperatorPublic(saved);
  }

  async findById(id: string): Promise<Operator | null> {
    return this.repo.findOne({ where: { id } });
  }
}
