import { ForbiddenException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { todayInDeployTz } from '../common/today-in-tz';
import { type AppEnv } from '../config/env-validation';
import { OperatorRole } from '../operators/operator.entity';
import { OperatorPublic } from '../operators/operator-public';
import { Tg8Document } from '../orders/tg8-document.entity';

export interface Tg8DocumentListItem {
  orderId: string;
  templateRevision: string;
  acceptedAt: Date;
  prisoner: { legacyId: string; name: string };
  totalAmount: number;
}

@Injectable()
export class Tg8DocumentsService {
  /** Database engine: 'postgres' or 'sqlite'. */
  private readonly dbType: string;

  constructor(
    @InjectRepository(Tg8Document)
    private readonly documents: Repository<Tg8Document>,
    private readonly configService: ConfigService<AppEnv, true>,
  ) {
    this.dbType = this.configService.get('DATABASE_TYPE', { infer: true });
  }

  /**
   * List TG8 documents for a given date, filtered by the deploy timezone.
   * Uses database-appropriate date filtering for PostgreSQL vs SQLite compatibility.
   */
  async listRecentTg8(
    actor: OperatorPublic,
    date = todayInDeployTz(),
  ): Promise<Tg8DocumentListItem[]> {
    if (![OperatorRole.CASHIER, OperatorRole.ADMIN].includes(actor.role)) {
      throw new ForbiddenException({
        message: 'TG8 documents are restricted to cashier staff',
        code: 'TG8.FORBIDDEN',
      });
    }

    const qb = this.documents
      .createQueryBuilder('document')
      .orderBy('document.accepted_at', 'DESC');

    if (this.dbType === 'sqlite') {
      qb.where('date(document.accepted_at) = :date', { date });
    } else {
      const timeZone = process.env.APP_TZ || 'Asia/Saigon';
      qb.where(
        'CAST(document.accepted_at AT TIME ZONE :timeZone AS date) = CAST(:date AS date)',
      ).setParameters({ timeZone, date });
    }

    const rows = await qb.getMany();

    return rows.map((document) => ({
      orderId: document.orderId,
      templateRevision: document.templateRevision,
      acceptedAt: document.acceptedAt,
      prisoner: {
        legacyId: document.snapshot.prisoner.legacyId,
        name: document.snapshot.prisoner.name,
      },
      totalAmount: document.snapshot.acceptedTotal,
    }));
  }
}
