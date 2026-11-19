import { Module } from '@nestjs/common';
import { SiteSettingsModule } from '../site-settings/site-settings.module';
import { EmailSettingsController } from './email-settings.controller';
import { EmailSettingsService } from './email-settings.service';
import { EmailNotificationsService } from './email-notifications.service';

@Module({
  imports: [SiteSettingsModule],
  controllers: [EmailSettingsController],
  providers: [EmailSettingsService, EmailNotificationsService],
  exports: [EmailSettingsService, EmailNotificationsService],
})
export class EmailNotificationsModule {}
