import { IsEmail, IsIn, IsOptional, IsString, Matches, MaxLength, MinLength, ValidateIf } from 'class-validator';

export class LoginDto {
  @IsString() @MaxLength(64) username: string;
  @IsString() @MaxLength(128) password: string;
}

export class ChangePasswordDto {
  @IsString() @MaxLength(128) currentPassword: string;
  @IsString() @MinLength(8) @MaxLength(128) newPassword: string;
}

export class CreateJoinApplicationDto {
  @IsString() @MaxLength(120) name: string;
  @IsEmail() @MaxLength(254) email: string;
  @IsString() @MaxLength(200) contact: string;
  @IsString() @Matches(/^[a-zA-Z0-9][a-zA-Z0-9_-]{2,31}$/, {
    message: '用户名需为 3-32 位字母、数字、下划线或短横线',
  }) desiredUsername: string;
  @IsOptional() @IsString() @MaxLength(1000) reason?: string;
}

export class ApproveJoinApplicationDto {
  @IsOptional() @IsString() @MinLength(8) @MaxLength(128) password?: string;
  @IsOptional() @IsString() @MaxLength(120) displayName?: string;
  @IsOptional() @ValidateIf((dto) => dto.email !== '') @IsEmail() @MaxLength(254) email?: string;
  @IsOptional() @IsString() @MaxLength(500) note?: string;
}

export class RejectJoinApplicationDto {
  @IsOptional() @IsString() @MaxLength(500) note?: string;
}

export class UpdateUserDto {
  @IsOptional() @IsString() @MaxLength(120) displayName?: string;
  @IsOptional() @ValidateIf((dto) => dto.email !== '') @IsEmail() @MaxLength(254) email?: string;
  @IsOptional() @IsIn(['admin', 'member']) role?: 'admin' | 'member';
  @IsOptional() @IsIn(['active', 'disabled']) status?: 'active' | 'disabled';
}
