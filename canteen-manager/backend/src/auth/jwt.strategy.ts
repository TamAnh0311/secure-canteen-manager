import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { Operator } from '../operators/operator.entity';
import { OperatorPublic, toOperatorPublic } from '../operators/operator-public';
import { JwtPayload } from './jwt-payload.interface';
import { AppEnv } from '../config/env-validation';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    configService: ConfigService<AppEnv, true>,
    @InjectRepository(Operator)
    private readonly operatorsRepo: Repository<Operator>,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: configService.get('JWT_SECRET', { infer: true }),
    });
  }

  // Called by Passport after signature + expiry verification.
  // Reloads the operator on every request so deactivation takes effect
  // without waiting for token expiry — necessary on a shared internal system.
  async validate(payload: JwtPayload): Promise<OperatorPublic> {
    const operator = await this.operatorsRepo.findOne({ where: { id: payload.sub } });
    if (!operator || !operator.isActive) {
      throw new UnauthorizedException({ message: 'Authentication required', code: 'AUTH.UNAUTHENTICATED' });
    }
    return toOperatorPublic(operator);
  }
}
