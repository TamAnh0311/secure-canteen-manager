import { Module } from '@nestjs/common';
import { OmrClientService } from './omr-client.service';

// OmrClientModule depends on nothing app-internal — safe to import anywhere
// without creating circular dependencies.
@Module({
  providers: [OmrClientService],
  exports: [OmrClientService],
})
export class OmrClientModule {}
