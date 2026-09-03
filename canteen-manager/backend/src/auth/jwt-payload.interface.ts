import { OperatorRole } from '../operators/operator.entity';

export interface JwtPayload {
  sub: string;       // operator uuid
  username: string;
  role: OperatorRole;
}
