import { Module } from '@nestjs/common';
import { AssetsModule } from '../assets/assets.module';
import { AdminCollabController, CollabController } from './collab.controller';
import { CollabService } from './collab.service';

@Module({
  imports: [AssetsModule],
  controllers: [CollabController, AdminCollabController],
  providers: [CollabService],
  exports: [CollabService],
})
export class CollabModule {}
