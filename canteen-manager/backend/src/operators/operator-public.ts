import { Operator, OperatorRole } from './operator.entity';

// Shared safe projection of an operator — never includes passwordHash.
// Used as the API response shape wherever operator data is returned.
export interface OperatorPublic {
  id: string;
  username: string;
  displayName: string;
  role: OperatorRole;
  zone?: string | null;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export function toOperatorPublic(operator: Operator): OperatorPublic {
  return {
    id: operator.id,
    username: operator.username,
    displayName: operator.displayName,
    role: operator.role,
    zone: operator.zone,
    isActive: operator.isActive,
    createdAt: operator.createdAt,
    updatedAt: operator.updatedAt,
  };
}

// bcrypt work factor — cost 12 balances security with login latency on air-gapped hardware
export const BCRYPT_COST = 12;
