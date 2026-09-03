import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query, Req } from '@nestjs/common';
import { CounterService, PrisonerLookup, PendingOrderRow } from './counter.service';
import { CreateTopupDto } from './dto/create-topup.dto';
import { CreateRelativeOrderDto } from './dto/create-relative-order.dto';
import { AcceptOrderDto } from './dto/accept-order.dto';
import { RejectOrderDto } from './dto/reject-order.dto';
import { Roles } from '../auth/roles.decorator';
import { OperatorRole } from '../operators/operator.entity';
import { OperatorPublic } from '../operators/operator-public';
import { OrderWithItems } from '../orders/orders.service';
import { ListTg8DocumentsDto } from './dto/list-tg8-documents.dto';
import { Tg8DocumentListItem, Tg8DocumentsService } from './tg8-documents.service';

interface AuthRequest {
  user: OperatorPublic;
}

// Staffed counter: balance top-ups and counter-paid relative orders. Every route is a
// money move, so the whole controller is gated to cashier/admin (RolesGuard reads the
// class-level decorator); plain operators get 403.
@Controller('counter')
@Roles(OperatorRole.CASHIER, OperatorRole.ADMIN)
export class CounterController {
  constructor(
    private readonly counterService: CounterService,
    private readonly tg8Documents: Tg8DocumentsService,
  ) {}

  @Get('prisoner/:prisonId')
  lookup(@Param('prisonId') prisonId: string): Promise<PrisonerLookup> {
    return this.counterService.lookup(prisonId);
  }

  @Post('topups')
  topup(
    @Body() dto: CreateTopupDto,
    @Req() req: AuthRequest,
  ): Promise<{ userId: string; balance: number }> {
    return this.counterService.topup({ ...dto, operatorId: req.user.id });
  }

  @Post('relative-orders')
  relativeOrder(
    @Body() dto: CreateRelativeOrderDto,
    @Req() req: AuthRequest,
  ): Promise<OrderWithItems> {
    return this.counterService.relativeOrder({ ...dto, operatorId: req.user.id });
  }

  // Pending-approval queue — relative orders (kiosk or counter) awaiting a cashier decision.
  @Get('pending-orders')
  pendingOrders(): Promise<PendingOrderRow[]> {
    return this.counterService.listPendingOrders();
  }

  @Get('tg8-documents')
  listTg8Documents(
    @Query() query: ListTg8DocumentsDto,
    @Req() req: AuthRequest,
  ): Promise<Tg8DocumentListItem[]> {
    return this.tg8Documents.listRecentTg8(req.user, query.date);
  }

  @Post('relative-orders/:id/accept')
  acceptOrder(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() dto: AcceptOrderDto,
    @Req() req: AuthRequest,
  ): Promise<OrderWithItems> {
    return this.counterService.acceptOrder(id, {
      method: dto.method,
      transferReference: dto.transferReference,
      receivedAmount: dto.receivedAmount,
      operatorId: req.user.id,
    });
  }

  @Post('relative-orders/:id/reject')
  rejectOrder(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() dto: RejectOrderDto,
    @Req() req: AuthRequest,
  ): Promise<OrderWithItems> {
    return this.counterService.rejectOrder(id, { reason: dto.reason, operatorId: req.user.id });
  }
}
