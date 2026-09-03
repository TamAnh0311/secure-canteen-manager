import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Order } from './order.entity';
import { OrderItem } from './order-item.entity';
import { OrdersService } from './orders.service';
import { OrdersController } from './orders.controller';
import { MenuModule } from '../menu/menu.module';
import { UsersModule } from '../users/users.module';
import { AccountsModule } from '../accounts/accounts.module';
import { PurchaseLimitConfigModule } from '../purchase-limit-config/purchase-limit-config.module';
import { Tg8Document } from './tg8-document.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([Order, OrderItem, Tg8Document]),
    MenuModule,
    UsersModule,
    AccountsModule,
    PurchaseLimitConfigModule,
  ],
  controllers: [OrdersController],
  providers: [OrdersService],
  exports: [OrdersService],
})
export class OrdersModule {}
