import { Module } from '@nestjs/common';
import { KioskController } from './kiosk.controller';
import { KioskService } from './kiosk.service';
import { UsersModule } from '../users/users.module';
import { MenuModule } from '../menu/menu.module';
import { OrdersModule } from '../orders/orders.module';
import { PaymentConfigModule } from '../payment-config/payment-config.module';
import { PurchaseLimitConfigModule } from '../purchase-limit-config/purchase-limit-config.module';
import { KioskLookupRateLimitGuard } from './kiosk-lookup-rate-limit.guard';

// Relative kiosk: a read-only prisoner view plus a public pending-order write. OrdersModule is
// imported for the write path. Note this is NOT itself the money-safety boundary — OrdersService
// injects AccountsService transitively — so kiosk orders are kept off the balance by forcing
// source='relative' server-side and whitelisting the DTO, not by which modules are imported.
@Module({
  imports: [UsersModule, MenuModule, OrdersModule, PaymentConfigModule, PurchaseLimitConfigModule],
  controllers: [KioskController],
  providers: [KioskService, KioskLookupRateLimitGuard],
})
export class KioskModule {}
