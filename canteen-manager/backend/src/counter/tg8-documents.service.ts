import { ForbiddenException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { todayInDeployTz } from '../common/today-in-tz';
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
  constructor(
    @InjectRepository(Tg8Document)
    private readonly documents: Repository<Tg8Document>,
  ) {}

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

    const timeZone = process.env.APP_TZ || 'Asia/Saigon';
    const rows = await this.documents
      .createQueryBuilder('document')
      .where(
        'CAST(document.accepted_at AT TIME ZONE :timeZone AS date) = CAST(:date AS date)',
      )
      .setParameters({ timeZone, date })
      .orderBy('document.accepted_at', 'DESC')
      .getMany();

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
