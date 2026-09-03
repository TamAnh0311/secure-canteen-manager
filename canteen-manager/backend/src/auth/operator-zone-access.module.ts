import { Global, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from '../users/user.entity';
import { OperatorZoneAccessService } from './operator-zone-access.service';

@Global()
@Module({
  imports: [TypeOrmModule.forFeature([User])],
  providers: [OperatorZoneAccessService],
  exports: [OperatorZoneAccessService],
})
export class OperatorZoneAccessModule {}
