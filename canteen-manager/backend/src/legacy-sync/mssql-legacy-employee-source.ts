/**
 * Reads employees from a legacy SQL Server 2005 instance over TDS 7.2.
 *
 * TLS connectivity — three tiers, all env-tunable:
 *
 *   Tier 1 (default, trusted LAN): LEGACY_SQL_ENCRYPT=false
 *     No TLS negotiation at all. Simplest; use when the SQL box is on a
 *     private VLAN and network-level trust is sufficient.
 *
 *   Tier 2 (encrypted, modern Node): LEGACY_SQL_ENCRYPT=true
 *     + LEGACY_SQL_TLS_MIN_VERSION=TLSv1
 *     OpenSSL 3 (bundled with Node 18+) dropped TLS 1.0 from its default
 *     security level. cryptoCredentialsDetails.minVersion re-enables it
 *     without touching the global OpenSSL config.
 *
 *   Tier 3 (Windows / NTLM auth): LEGACY_SQL_ENCRYPT=true
 *     + NODE_OPTIONS=--openssl-legacy-provider at process start
 *     Required only when the server uses NTLM/Windows Authentication,
 *     which depends on MD4 — a hash algorithm OpenSSL 3 disabled by default.
 *     Tier 2 alone is insufficient because tedious negotiates the auth
 *     handshake before the TLS channel, so the legacy provider must be
 *     active at Node startup, not just connection time.
 *
 * SQL Server 2005 speaks TDS 7.2. The `mssql` package uses tedious 19 under
 * the hood; tedious negotiates TDS version from the `tdsVersion` option.
 * Default query aliases: legacyId, name, zone, cell, dateOfBirth, hometown, offense,
 * arrestDate, detentionStatus, isActive.
 * `cell` and the five detainee-profile aliases (dateOfBirth, hometown, offense, arrestDate,
 * detentionStatus) ship as NULL until the operator wires the real MSSQL columns — never select
 * a literal column that may not exist, or every sync throws "Invalid column name '...'".
 * Override with LEGACY_SQL_QUERY for site-specific schema.
 */

import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { AppEnv } from '../config/env-validation';
import { LegacyEmployee, LegacyEmployeeSource } from './legacy-employee-source';
import { DetentionStatus } from '../users/user.entity';
import { normalizeZone } from '../common/zone-normalization';

// Mapping-rule note for the site DBA tuning LEGACY_SQL_QUERY:
//   The five detainee-profile aliases are NULL here so the stock query runs against any
//   dbo.Employees. To populate them, alias the real columns (e.g. CAST(DOB AS DATE) AS
//   dateOfBirth). detentionStatus MUST emit one of 'temporary_hold' | 'pre_trial_detention' |
//   'convicted' — map the legacy status code with a CASE; any other value lands as null (see
//   mapLegacyRow). Dates should be 'YYYY-MM-DD'. Tune later — left NULL for the initial build.
const DEFAULT_QUERY = `
  SELECT
    CAST(EmployeeID AS NVARCHAR(255)) AS legacyId,
    FullName                          AS name,
    Department                        AS zone,
    NULL                              AS cell,
    NULL                              AS dateOfBirth,
    NULL                              AS hometown,
    NULL                              AS offense,
    NULL                              AS arrestDate,
    NULL                              AS detentionStatus,
    1                                 AS isActive
  FROM dbo.Employees
`.trim();

export interface RawRow {
  legacyId: unknown;
  name: unknown;
  zone: unknown;
  cell: unknown;
  dateOfBirth: unknown;
  hometown: unknown;
  offense: unknown;
  arrestDate: unknown;
  detentionStatus: unknown;
  isActive: unknown;
}

// Coerce a raw legacy row into a canonical LegacyEmployee. Pure (no DB) so the coercion and the
// detention-status validation are unit-testable. An unknown/garbage detention_status maps to
// null rather than throwing, so a mis-mapped legacy column can never crash a sync run.
export function mapLegacyRow(row: RawRow): LegacyEmployee {
  const status = row.detentionStatus != null ? String(row.detentionStatus) : null;
  const detentionStatus = (Object.values(DetentionStatus) as string[]).includes(status ?? '')
    ? (status as DetentionStatus)
    : null;
  return {
    legacyId: String(row.legacyId ?? ''),
    name: String(row.name ?? ''),
    zone: normalizeZone(row.zone != null ? String(row.zone) : null),
    cell: row.cell != null ? String(row.cell) : null,
    dateOfBirth: row.dateOfBirth != null ? String(row.dateOfBirth) : null,
    hometown: row.hometown != null ? String(row.hometown) : null,
    offense: row.offense != null ? String(row.offense) : null,
    arrestDate: row.arrestDate != null ? String(row.arrestDate) : null,
    detentionStatus,
    isActive: Boolean(row.isActive),
  };
}

@Injectable()
export class MssqlLegacyEmployeeSource implements LegacyEmployeeSource {
  constructor(private readonly config: ConfigService<AppEnv, true>) {}

  async fetchEmployees(): Promise<LegacyEmployee[]> {
    const host = this.config.get('LEGACY_SQL_HOST', { infer: true });
    const username = this.config.get('LEGACY_SQL_USER', { infer: true });
    const password = this.config.get('LEGACY_SQL_PASS', { infer: true });
    const database = this.config.get('LEGACY_SQL_DB', { infer: true });

    if (!host || !username || !password || !database) {
      throw new Error(
        'Legacy SQL connection not configured: LEGACY_SQL_HOST, LEGACY_SQL_USER, LEGACY_SQL_PASS, LEGACY_SQL_DB are required',
      );
    }

    const port = this.config.get('LEGACY_SQL_PORT', { infer: true });
    const encrypt = this.config.get('LEGACY_SQL_ENCRYPT', { infer: true });
    const trustServerCertificate = this.config.get('LEGACY_SQL_TRUST_CERT', { infer: true });
    const tdsVersion = this.config.get('LEGACY_SQL_TDS_VERSION', { infer: true });
    const tlsMinVersion = this.config.get('LEGACY_SQL_TLS_MIN_VERSION', { infer: true });
    const poolSize = this.config.get('LEGACY_SQL_POOL_SIZE', { infer: true });
    const queryTimeout = this.config.get('LEGACY_SQL_QUERY_TIMEOUT_MS', { infer: true });
    const query = this.config.get('LEGACY_SQL_QUERY', { infer: true }) ?? DEFAULT_QUERY;

    const cryptoCredentialsDetails =
      encrypt && tlsMinVersion ? { minVersion: tlsMinVersion } : {};

    const ds = new DataSource({
      type: 'mssql',
      host,
      port,
      username,
      password,
      database,
      synchronize: false,
      logging: false,
      // maxQueryExecutionTime only logs slow queries; requestTimeout actually aborts them.
      maxQueryExecutionTime: queryTimeout,
      extra: {
        tdsVersion,
        encrypt,
        trustServerCertificate,
        pool: { max: poolSize },
        // requestTimeout aborts a hung query — makes LEGACY_SQL_QUERY_TIMEOUT_MS honest.
        // connectTimeout fails fast when the host is unreachable (capped at 15 s so a
        // mis-configured box doesn't hold `running=true` for the full query timeout).
        requestTimeout: queryTimeout,
        connectTimeout: Math.min(queryTimeout, 15000),
        ...(Object.keys(cryptoCredentialsDetails).length > 0
          ? { cryptoCredentialsDetails }
          : {}),
      },
    });

    await ds.initialize();
    try {
      const rows: RawRow[] = await ds.query(query);
      return rows.map(mapLegacyRow);
    } finally {
      await ds.destroy();
    }
  }
}
