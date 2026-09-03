import { Module } from '@nestjs/common';
import { CounterController } from './counter.controller';
import { CounterService } from './counter.service';
import { UsersModule } from '../users/users.module';
import { AccountsModule } from '../accounts/accounts.module';
import { OrdersModule } from '../orders/orders.module';
import { MenuModule } from '../menu/menu.module';
import { PurchaseLimitConfigModule } from '../purchase-limit-config/purchase-limit-config.module';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Tg8Document } from '../orders/tg8-document.entity';
import { Tg8DocumentsService } from './tg8-documents.service';

// Staffed-counter money operations + the pending-approval queue, composed from the existing
// user/account/order services. Menu is imported to enrich queue rows with item names.
@Module({
  imports: [
    TypeOrmModule.forFeature([Tg8Document]),
    UsersModule,
    AccountsModule,
    OrdersModule,
    MenuModule,
    PurchaseLimitConfigModule,
  ],
  controllers: [CounterController],
  providers: [CounterService, Tg8DocumentsService],
})
export class CounterModule {}
