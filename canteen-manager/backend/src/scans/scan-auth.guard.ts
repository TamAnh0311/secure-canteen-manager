import { CanActivate, ExecutionContext, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Request } from 'express';
import { createHash, timingSafeEqual } from 'crypto';
import { Operator, OperatorRole } from '../operators/operator.entity';
import { AppEnv } from '../config/env-validation';
import { JwtPayload } from '../auth/jwt-payload.interface';
import { toOperatorPublic } from '../operators/operator-public';

// Accepts either:
//   1. x-agent-token header matching AGENT_TOKEN env (for hardware scanning agents)
//   2. A valid operator JWT in Authorization: Bearer <token> (for operator tools)
// Generic 401 on all failure paths — no enumeration of which check failed.
@Injectable()
export class ScanAuthGuard implements CanActivate {
  // undefined when AGENT_TOKEN is unset — the x-agent-token path is then disabled
  // (rejected) rather than matching a default. Operator JWT remains the second path.
  private readonly agentToken: string | undefined;

  constructor(
    private readonly config: ConfigService<AppEnv, true>,
    private readonly jwtService: JwtService,
    @InjectRepository(Operator)
    private readonly operatorsRepo: Repository<Operator>,
  ) {
    this.agentToken = this.config.get('AGENT_TOKEN', { infer: true });
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request & { user?: unknown; scanCredentialId?: string }>();

    // Path 1: hardware agent token (only when one is configured)
    const agentHeader = req.headers['x-agent-token'];
    if (this.agentToken && typeof agentHeader === 'string' && this.agentTokenMatches(agentHeader)) {
      req.scanCredentialId = 'hardware-agent';
      return true;
    }

    // Path 2: operator JWT — mirror JwtStrategy.validate without Passport overhead
    const authHeader = req.headers['authorization'];
    if (typeof authHeader === 'string' && authHeader.startsWith('Bearer ')) {
      const token = authHeader.slice(7);
      try {
        const payload = await this.jwtService.verifyAsync<JwtPayload>(token);
        const operator = await this.operatorsRepo.findOne({ where: { id: payload.sub } });
        if (operator && operator.isActive) {
          if (![OperatorRole.OPERATOR, OperatorRole.ADMIN].includes(operator.role)) {
            throw new ForbiddenException({ message: 'Insufficient role', code: 'AUTH.INSUFFICIENT_ROLE' });
          }
          req.user = toOperatorPublic(operator);
          req.scanCredentialId = `operator:${operator.id}`;
          return true;
        }
      } catch (error) {
        if (error instanceof ForbiddenException) throw error;
        // Fall through to 401 — invalid/expired token
      }
    }

    throw new UnauthorizedException({ message: 'Authentication required', code: 'AUTH.UNAUTHENTICATED' });
  }

  // Constant-time agent-token check. Hashing both sides to a fixed-width digest
  // before timingSafeEqual keeps the comparison time independent of the token
  // value AND its length (timingSafeEqual itself throws on length mismatch and a
  // raw === short-circuits on the first differing byte — both are timing oracles).
  private agentTokenMatches(provided: string): boolean {
    if (!this.agentToken) return false;
    const digest = (value: string): Buffer =>
      createHash('sha256').update(value, 'utf8').digest();
    return timingSafeEqual(digest(provided), digest(this.agentToken));
  }
}
