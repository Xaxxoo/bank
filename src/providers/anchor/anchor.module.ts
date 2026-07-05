import { Module } from '@nestjs/common';
import { AnchorService } from './anchor.service';

@Module({
  providers: [AnchorService],
  exports: [AnchorService],
})
export class AnchorModule {}
