import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PrisonerAccount } from './prisoner-account.entity';
import { AccountTransaction } from './account-transaction.entity';
import { AccountsService } from './accounts.service';
import { AccountsController } from './accounts.controller';

// Exports AccountsService so the warden-debit (order) and cashier (topup) paths in
// later phases can compose credit()/debit() inside their own transactions.
@Module({
  imports: [TypeOrmModule.forFeature([PrisonerAccount, AccountTransaction])],
  controllers: [AccountsController],
  providers: [AccountsService],
  exports: [AccountsService],
})
export class AccountsModule {}
