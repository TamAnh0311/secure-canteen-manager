import { SetMetadata } from '@nestjs/common';
import { OperatorRole } from '../operators/operator.entity';

export const ROLES_KEY = 'roles';

/** Restrict a route to one or more operator roles. Enforced by RolesGuard. */
export const Roles = (...roles: OperatorRole[]) => SetMetadata(ROLES_KEY, roles);
