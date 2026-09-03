import { Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import { AccountsService } from './accounts.service';
import { ListLedgerDto } from './dto/list-ledger.dto';
import { Roles } from '../auth/roles.decorator';
import { OperatorRole } from '../operators/operator.entity';
import { AccountTransaction } from './account-transaction.entity';

// Balance and ledger are commissary money records — admin-only reads (mirrors the
// write-gating on MenuController). Any-operator access is intentionally NOT granted here.
@Controller('accounts')
export class AccountsController {
  constructor(private readonly accountsService: AccountsService) {}

  @Get(':userId/balance')
  @Roles(OperatorRole.ADMIN)
  async getBalance(
    @Param('userId', ParseUUIDPipe) userId: string,
  ): Promise<{ userId: string; balance: number }> {
    const balance = await this.accountsService.getBalance(userId);
    return { userId, balance };
  }

  @Get(':userId/ledger')
  @Roles(OperatorRole.ADMIN)
  getLedger(
    @Param('userId', ParseUUIDPipe) userId: string,
    @Query() query: ListLedgerDto,
  ): Promise<AccountTransaction[]> {
    return this.accountsService.getLedger(userId, { limit: query.limit, offset: query.offset });
  }
}
