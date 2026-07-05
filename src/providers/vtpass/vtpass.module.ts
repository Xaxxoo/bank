import { Module } from '@nestjs/common';
import { VTPassService } from './vtpass.service';

@Module({
  providers: [VTPassService],
  exports: [VTPassService],
})
export class VTPassModule {}
