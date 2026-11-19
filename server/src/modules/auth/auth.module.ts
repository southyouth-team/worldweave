import { Global, Module } from '@nestjs/common';
import { EmailNotificationsModule } from '../email-notifications/email-notifications.module';
import { AdminController } from './admin.controller';
import { AuthBootstrapService } from './auth-bootstrap.service';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { RolesGuard } from './roles.guard';
import { SessionAuthGuard } from './session-auth.guard';
import { SessionService } from './session.service';

@Global()
@Module({
  imports: [EmailNotificationsModule],
  controllers: [AuthController, AdminController],
  providers: [AuthService, SessionService, SessionAuthGuard, RolesGuard, AuthBootstrapService],
  exports: [AuthService, SessionService, SessionAuthGuard, RolesGuard],
})
export class AuthModule {}
