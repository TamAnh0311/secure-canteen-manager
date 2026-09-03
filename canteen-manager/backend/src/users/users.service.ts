import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository, SelectQueryBuilder } from 'typeorm';
import { User } from './user.entity';
import { OperatorPublic } from '../operators/operator-public';
import { OperatorZoneAccessService } from '../auth/operator-zone-access.service';
import { normalizeZone } from '../common/zone-normalization';
import { CELL_NORMALIZATION_VERSION, normalizeCellV1 } from './cell-normalization';

interface ListOptions {
  limit: number;
  offset: number;
}

interface SearchOptions {
  q?: string;
  zone?: string;
  limit: number;
  offset: number;
}

interface ActiveCandidateSearchOptions {
  q: string;
  limit?: number;
}

// A directory row with the prisoner's current commissary balance (integer VND) joined in.
export type UserListItem = User & { balance: number };

export interface IssuanceRosterRow {
  id: string;
  legacyId: string;
  name: string;
  zone: string;
  cell: string | null;
}

export interface IssuanceRosterOptions {
  zones: Array<{ zone: string; cells: Array<string | null> }>;
}

export interface CellNormalizationAudit {
  activeUsers: number;
  blank: number;
  staleVersion: number;
  collisionGroups: number;
  usersInCollisions: number;
  version: number;
}

export interface ScannerIdentityReadiness {
  activeUsers: number;
  invalidLegacyIds: number;
  ready: boolean;
}

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User)
    private readonly repo: Repository<User>,
    private readonly zoneAccess?: OperatorZoneAccessService,
  ) {}

  // Base directory query: prisoners ordered by name, each with their commissary balance
  // left-joined (COALESCE 0 when no account row exists yet) for the /prisoner screen.
  private directoryQuery(opts: ListOptions, actor?: OperatorPublic): SelectQueryBuilder<User> {
    const qb = this.repo
      .createQueryBuilder('u')
      .leftJoin('prisoner_accounts', 'pa', 'pa.user_id = u.id')
      .addSelect('COALESCE(pa.balance, 0)', 'balance')
      .orderBy('u.name', 'ASC')
      .take(opts.limit)
      .skip(opts.offset);
    return actor ? this.zoneAccess!.scopeByUser(qb, actor, 'u.zone') : qb;
  }

  // Merge the raw `balance` column (bigint → string) back onto each hydrated entity.
  private async withBalance(qb: SelectQueryBuilder<User>): Promise<UserListItem[]> {
    const { entities, raw } = await qb.getRawAndEntities();
    return entities.map((u, i) => ({ ...u, balance: Number(raw[i].balance) }));
  }

  list(opts: ListOptions, actor?: OperatorPublic): Promise<UserListItem[]> {
    return this.withBalance(this.directoryQuery(opts, actor));
  }

  search(opts: SearchOptions, actor?: OperatorPublic): Promise<UserListItem[]> {
    const qb = this.directoryQuery(opts, actor);

    if (opts.q) {
      qb.andWhere(
        '(u.name ILIKE :q OR u.legacy_id ILIKE :q)',
        { q: `%${opts.q}%` },
      );
    }

    if (opts.zone) {
      qb.andWhere('u.zone ILIKE :zone', { zone: `%${opts.zone}%` });
    }

    return this.withBalance(qb);
  }

  async listDistinctZones(): Promise<string[]> {
    const rows = await this.repo
      .createQueryBuilder('u')
      .select('DISTINCT BTRIM(u.zone)', 'zone')
      .where('u.zone IS NOT NULL')
      .andWhere("BTRIM(u.zone) <> ''")
      .orderBy('zone', 'ASC')
      .getRawMany<{ zone: string }>();
    return rows.map((row) => normalizeZone(row.zone)).filter((zone): zone is string => zone !== null);
  }

  async scannerIdentityReadiness(): Promise<ScannerIdentityReadiness> {
    const row = await this.repo
      .createQueryBuilder('u')
      .select('COUNT(*)', 'activeUsers')
      .addSelect(
        "COUNT(*) FILTER (WHERE BTRIM(u.legacy_id) !~ '^[0-9]{6}$')",
        'invalidLegacyIds',
      )
      .where('u.is_active = true')
      .getRawOne<{ activeUsers: string; invalidLegacyIds: string }>();
    const activeUsers = Number(row?.activeUsers ?? 0);
    const invalidLegacyIds = Number(row?.invalidLegacyIds ?? 0);
    return { activeUsers, invalidLegacyIds, ready: invalidLegacyIds === 0 };
  }

  async listIssuanceRosterOptions(actor: OperatorPublic): Promise<IssuanceRosterOptions> {
    const qb = this.repo
      .createQueryBuilder('u')
      .select('BTRIM(u.zone)', 'zone')
      .addSelect("NULLIF(BTRIM(u.cell), '')", 'cell')
      .where('u.is_active = true')
      .andWhere('u.zone IS NOT NULL')
      .andWhere("BTRIM(u.zone) <> ''")
      .distinct(true)
      .orderBy('zone', 'ASC')
      .addOrderBy('cell', 'ASC', 'NULLS FIRST');
    this.zoneAccess!.scopeByUser(qb, actor, 'u.zone');
    const rows = await qb.getRawMany<{ zone: string; cell: string | null }>();
    const zones = new Map<string, Array<string | null>>();
    for (const row of rows) {
      const cells = zones.get(row.zone) ?? [];
      if (!cells.includes(row.cell)) cells.push(row.cell);
      zones.set(row.zone, cells);
    }
    return { zones: Array.from(zones, ([zone, cells]) => ({ zone, cells })) };
  }

  async listIssuanceRoster(
    actor: OperatorPublic,
    exactZone: string,
    exactCell: string | null,
  ): Promise<IssuanceRosterRow[]> {
    const zone = normalizeZone(exactZone);
    if (!zone) {
      throw new BadRequestException({ message: 'A valid prison zone is required', code: 'OMR_FORM.ROSTER_ZONE_REQUIRED' });
    }
    const qb = this.repo
      .createQueryBuilder('u')
      .select(['u.id', 'u.legacyId', 'u.name', 'u.zone', 'u.cell'])
      .where('u.is_active = true')
      .andWhere('BTRIM(u.zone) = :rosterZone', { rosterZone: zone })
      .orderBy('BTRIM(u.zone)', 'ASC')
      .addOrderBy("NULLIF(BTRIM(u.cell), '')", 'ASC', 'NULLS FIRST')
      .addOrderBy('u.name', 'ASC')
      .addOrderBy('u.legacyId', 'ASC')
      .addOrderBy('u.id', 'ASC');
    if (exactCell === null) {
      qb.andWhere("NULLIF(BTRIM(u.cell), '') IS NULL");
    } else {
      qb.andWhere("NULLIF(BTRIM(u.cell), '') = :rosterCell", { rosterCell: exactCell.trim() });
    }
    this.zoneAccess!.scopeByUser(qb, actor, 'u.zone', 'rosterActorZone');
    const users = await qb.getMany();
    return users.map((user) => ({
      id: user.id,
      legacyId: user.legacyId,
      name: user.name,
      zone: user.zone!.trim(),
      cell: user.cell?.trim() || null,
    }));
  }

  async loadIssuanceSelection(actor: OperatorPublic, userIds: string[]): Promise<User[]> {
    const ids = [...new Set(userIds)].sort();
    const qb = this.repo
      .createQueryBuilder('u')
      .where('u.id IN (:...userIds)', { userIds: ids })
      .andWhere('u.is_active = true')
      .orderBy('u.id', 'ASC');
    this.zoneAccess!.scopeByUser(qb, actor, 'u.zone', 'selectionActorZone');
    const users = await qb.getMany();
    if (users.length !== ids.length) {
      throw new NotFoundException({ message: 'One or more prisoners are unavailable', code: 'USER.NOT_FOUND' });
    }
    const [first] = users;
    const zone = first.zone?.trim() || null;
    const cell = first.cell?.trim() || null;
    if (!zone || users.some((user) => (user.zone?.trim() || null) !== zone || (user.cell?.trim() || null) !== cell)) {
      throw new BadRequestException({
        message: 'All selected prisoners must belong to the same current zone and cell',
        code: 'OMR_FORM.ROSTER_MISMATCH',
      });
    }
    return users;
  }

  async findActiveByExactCell(
    rawCell: string,
    actor: OperatorPublic,
    manager?: EntityManager,
  ): Promise<User[]> {
    const normalizedCell = normalizeCellV1(rawCell);
    if (!normalizedCell) return [];
    const repo = manager ? manager.getRepository(User) : this.repo;
    const qb = repo
      .createQueryBuilder('u')
      .where('u.is_active = true')
      .andWhere('u.normalized_cell = :normalizedCell', { normalizedCell })
      .andWhere('u.cell_normalization_version = :normalizationVersion', {
        normalizationVersion: CELL_NORMALIZATION_VERSION,
      })
      .orderBy('u.name', 'ASC')
      .addOrderBy('u.legacyId', 'ASC')
      .addOrderBy('u.id', 'ASC');
    this.zoneAccess!.scopeByUser(qb, actor, 'u.zone', 'cellActorZone');
    return qb.getMany();
  }

  async searchActiveCandidates(
    actor: OperatorPublic,
    options: ActiveCandidateSearchOptions,
  ): Promise<User[]> {
    const q = options.q.trim();
    if (q.length < 2) return [];
    const qb = this.repo
      .createQueryBuilder('u')
      .where('u.is_active = true')
      .andWhere('(u.name ILIKE :candidateQuery OR u.legacy_id ILIKE :candidateQuery OR u.cell ILIKE :candidateQuery)', {
        candidateQuery: `%${q}%`,
      })
      .orderBy('u.name', 'ASC')
      .addOrderBy('u.legacyId', 'ASC')
      .take(Math.min(options.limit ?? 20, 20));
    this.zoneAccess!.scopeByUser(qb, actor, 'u.zone', 'candidateActorZone');
    return qb.getMany();
  }

  async auditCellNormalization(manager?: EntityManager): Promise<CellNormalizationAudit> {
    const repo = manager ? manager.getRepository(User) : this.repo;
    const rows = await repo.query(`
      WITH active AS (
        SELECT normalized_cell, cell_normalization_version
        FROM users
        WHERE is_active = true
      ), collisions AS (
        SELECT normalized_cell, count(*)::int AS occupants
        FROM active
        WHERE normalized_cell IS NOT NULL
          AND normalized_cell <> ''
          AND cell_normalization_version = $1
        GROUP BY normalized_cell
        HAVING count(*) > 1
      )
      SELECT
        count(*)::int AS active_users,
        count(*) FILTER (WHERE normalized_cell IS NULL OR normalized_cell = '')::int AS blank,
        count(*) FILTER (WHERE cell_normalization_version IS DISTINCT FROM $1)::int AS stale_version,
        (SELECT count(*)::int FROM collisions) AS collision_groups,
        COALESCE((SELECT sum(occupants)::int FROM collisions), 0) AS users_in_collisions
      FROM active
    `, [CELL_NORMALIZATION_VERSION]) as Array<{
      active_users: number;
      blank: number;
      stale_version: number;
      collision_groups: number;
      users_in_collisions: number;
    }>;
    const row = rows[0] ?? {
      active_users: 0,
      blank: 0,
      stale_version: 0,
      collision_groups: 0,
      users_in_collisions: 0,
    };
    return {
      activeUsers: Number(row.active_users),
      blank: Number(row.blank),
      staleVersion: Number(row.stale_version),
      collisionGroups: Number(row.collision_groups),
      usersInCollisions: Number(row.users_in_collisions),
      version: CELL_NORMALIZATION_VERSION,
    };
  }

  async assertGenericCellIdentityReady(manager?: EntityManager): Promise<CellNormalizationAudit> {
    const audit = await this.auditCellNormalization(manager);
    if (audit.blank || audit.staleVersion || audit.collisionGroups) {
      throw new ConflictException({
        message: 'Generic OMR mode requires fresh, nonblank, unique normalized prisoner cells',
        code: 'OMR_GENERIC.CELL_AUDIT_FAILED',
        audit,
      });
    }
    return audit;
  }

  async findByLegacyId(legacyId: string): Promise<User | null> {
    return this.repo.findOne({ where: { legacyId } });
  }

  async findById(id: string): Promise<User> {
    const user = await this.repo.findOne({ where: { id } });
    if (!user) {
      throw new NotFoundException({ message: 'User not found', code: 'USER.NOT_FOUND' });
    }
    return user;
  }

  async findByIdForActor(id: string, actor: OperatorPublic): Promise<User> {
    return this.zoneAccess!.assertUserAccess(actor, id);
  }

  // Money paths must reject prisoners released/transferred out (is_active=false).
  // Throws USER.NOT_FOUND if absent, USER.INACTIVE if deactivated.
  async assertActive(id: string): Promise<User> {
    const user = await this.findById(id);
    if (!user.isActive) {
      throw new BadRequestException({ message: 'Prisoner account is inactive', code: 'USER.INACTIVE' });
    }
    return user;
  }
}
