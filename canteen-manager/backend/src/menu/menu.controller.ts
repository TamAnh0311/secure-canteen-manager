import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { MenuService, MenuItemSummary } from './menu.service';
import { CreateMenuItemDto } from './dto/create-menu-item.dto';
import { UpdateMenuItemDto } from './dto/update-menu-item.dto';
import { ReorderMenuDto } from './dto/reorder-menu.dto';
import { MenuSummaryQueryDto } from './dto/menu-summary-query.dto';
import { Roles } from '../auth/roles.decorator';
import { OperatorRole } from '../operators/operator.entity';
import { MenuItem } from './menu-item.entity';
import { OperatorPublic } from '../operators/operator-public';

interface AuthRequest {
  user: OperatorPublic;
}

@Controller('menu')
export class MenuController {
  constructor(private readonly menuService: MenuService) {}

  // Staff-readable: the kiosk and counter need the global menu list.
  @Get()
  list(): Promise<MenuItem[]> {
    return this.menuService.listAll();
  }

  // Kitchen summary for a single service date (defaults to today). Staff-readable.
  @Get('summary')
  summary(
    @Query() query: MenuSummaryQueryDto,
    @Req() req: AuthRequest,
  ): Promise<MenuItemSummary[]> {
    return this.menuService.getSummary(query.date, req.user);
  }

  // Every mutation is ADMIN-only: a non-admin able to mutate the menu could trigger a
  // position remap (wrong-item debit).
  @Post()
  @Roles(OperatorRole.ADMIN)
  addItem(@Body() dto: CreateMenuItemDto): Promise<MenuItem> {
    return this.menuService.addItem(dto);
  }

  @Patch(':id')
  @Roles(OperatorRole.ADMIN)
  updateItem(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateMenuItemDto,
  ): Promise<MenuItem> {
    return this.menuService.updateItem(id, dto);
  }

  @Delete(':id')
  @Roles(OperatorRole.ADMIN)
  @HttpCode(HttpStatus.NO_CONTENT)
  removeItem(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.menuService.removeItem(id);
  }

  @Post('reorder')
  @Roles(OperatorRole.ADMIN)
  reorder(@Body() dto: ReorderMenuDto): Promise<MenuItem[]> {
    return this.menuService.reorder(dto.orderedItemIds);
  }
}
