import { Module } from '@nestjs/common';
import { AssetsModule } from '../assets/assets.module';
import { AdminPublishRequestsController, PublishedHomepageController, PublishRequestsController } from './publish-requests.controller';
import { PublishRequestsService } from './publish-requests.service';

@Module({
  imports: [AssetsModule],
  controllers: [PublishRequestsController, AdminPublishRequestsController, PublishedHomepageController],
  providers: [PublishRequestsService],
})
export class PublishRequestsModule {}
