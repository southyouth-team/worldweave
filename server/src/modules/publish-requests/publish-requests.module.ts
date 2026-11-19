import { Module } from '@nestjs/common';
import { AssetsModule } from '../assets/assets.module';
import { EmailNotificationsModule } from '../email-notifications/email-notifications.module';
import { AdminPublishRequestsController, PublishedHomepageController, PublishRequestsController } from './publish-requests.controller';
import { PublishRequestsService } from './publish-requests.service';

@Module({
  imports: [AssetsModule, EmailNotificationsModule],
  controllers: [PublishRequestsController, AdminPublishRequestsController, PublishedHomepageController],
  providers: [PublishRequestsService],
})
export class PublishRequestsModule {}
