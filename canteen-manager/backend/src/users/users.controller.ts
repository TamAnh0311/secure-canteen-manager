import { Controller, Get, Param, ParseUUIDPipe, Query, Req } from '@nestjs/common';
import { UsersService, UserListItem } from './users.service';
import { ListUsersDto } from './dto/list-users.dto';
import { User } from './user.entity';
import { OperatorPublic } from '../operators/operator-public';
import { Roles } from '../auth/roles.decorator';
import { OperatorRole } from '../operators/operator.entity';

interface AuthRequest {
  user: OperatorPublic;
}

@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get()
  list(@Query() query: ListUsersDto, @Req() req: AuthRequest): Promise<UserListItem[]> {
    if (query.q || query.zone) {
      return this.usersService.search({
        q: query.q,
        zone: query.zone,
        limit: query.limit,
        offset: query.offset,
      }, req.user);
    }
    return this.usersService.list({ limit: query.limit, offset: query.offset }, req.user);
  }

  @Get('zones')
  @Roles(OperatorRole.ADMIN)
  listZones(): Promise<string[]> {
    return this.usersService.listDistinctZones();
  }

  @Get('scanner-readiness')
  @Roles(OperatorRole.ADMIN)
  scannerReadiness(): ReturnType<UsersService['scannerIdentityReadiness']> {
    return this.usersService.scannerIdentityReadiness();
  }

  @Get(':id')
  findOne(@Param('id', ParseUUIDPipe) id: string, @Req() req: AuthRequest): Promise<User> {
    return this.usersService.findByIdForActor(id, req.user);
  }
}
