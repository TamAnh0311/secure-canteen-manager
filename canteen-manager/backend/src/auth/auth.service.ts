import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as bcrypt from 'bcrypt';
import { Operator } from '../operators/operator.entity';
import { OperatorPublic, toOperatorPublic, BCRYPT_COST } from '../operators/operator-public';
import { JwtPayload } from './jwt-payload.interface';

export { OperatorPublic };

@Injectable()
export class AuthService {
  constructor(
    @InjectRepository(Operator)
    private readonly operatorsRepo: Repository<Operator>,
    private readonly jwtService: JwtService,
  ) {}

  async validateAndLogin(
    username: string,
    password: string,
  ): Promise<{ token: string; operator: OperatorPublic }> {
    // Generic error message prevents username enumeration. Single shared instance
    // ensures identical response body for wrong-password vs unknown-username paths.
    const invalidError = new UnauthorizedException({ message: 'Invalid credentials', code: 'AUTH.INVALID_CREDENTIALS' });

    const operator = await this.operatorsRepo.findOne({ where: { username } });
    if (!operator) {
      // Dummy compare maintains constant-time behaviour regardless of username existence
      await bcrypt.compare(password, `$2b$${BCRYPT_COST}$invalidhashpaddingtoconsistenttime`);
      throw invalidError;
    }

    const passwordValid = await bcrypt.compare(password, operator.passwordHash);
    if (!passwordValid) {
      throw invalidError;
    }

    if (!operator.isActive) {
      throw invalidError;
    }

    const payload: JwtPayload = {
      sub: operator.id,
      username: operator.username,
      role: operator.role,
    };

    const token = this.jwtService.sign(payload);
    return { token, operator: toOperatorPublic(operator) };
  }
}
