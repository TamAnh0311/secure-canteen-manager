/**
 * Abstraction over the external read-only data source (SQL Server 2005).
 *
 * Separating the interface from the implementation lets sync logic be fully
 * tested with an in-memory test double while the real MSSQL driver is only
 * exercised against the live box in staging.
 */

import { DetentionStatus } from '../users/user.entity';

export interface LegacyEmployee {
  legacyId: string;
  name: string;
  zone: string | null;
  cell: string | null;
  // Read-only detainee profile. Null until the site DBA maps real legacy columns via
  // LEGACY_SQL_QUERY; the stock query ships these as NULL aliases.
  dateOfBirth: string | null;
  hometown: string | null;
  offense: string | null;
  arrestDate: string | null;
  detentionStatus: DetentionStatus | null;
  isActive: boolean;
}

export interface LegacyEmployeeSource {
  fetchEmployees(): Promise<LegacyEmployee[]>;
}

export const LEGACY_EMPLOYEE_SOURCE = Symbol('LEGACY_EMPLOYEE_SOURCE');
