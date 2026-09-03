import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { MenuItem } from './menu-item.entity';
import { MenuService } from './menu.service';
import { MenuController } from './menu.controller';

@Module({
  imports: [TypeOrmModule.forFeature([MenuItem])],
  controllers: [MenuController],
  providers: [MenuService],
  exports: [MenuService],
})
export class MenuModule {}
