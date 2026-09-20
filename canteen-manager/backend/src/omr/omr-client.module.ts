import { Module } from '@nestjs/common';
import { OmrClientService } from './omr-client.service';
import { LocalFormRendererService } from './local-form-renderer';

// OmrClientModule depends on nothing app-internal — safe to import anywhere
// without creating circular dependencies.
@Module({
  providers: [OmrClientService, LocalFormRendererService],
  exports: [OmrClientService, LocalFormRendererService],
})
export class OmrClientModule {}
