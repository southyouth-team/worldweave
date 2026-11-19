import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class EmailSettingsDto {
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  host?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(65535)
  port?: number;

  @IsOptional()
  @IsBoolean()
  secure?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  username?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  password?: string;

  @IsOptional()
  @IsBoolean()
  clearPassword?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  fromName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(254)
  fromEmail?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  adminRecipients?: string;

  @IsOptional()
  @IsBoolean()
  notifyJoinApplication?: boolean;

  @IsOptional()
  @IsBoolean()
  notifyPublishRequest?: boolean;

  @IsOptional()
  @IsBoolean()
  notifyReviewResult?: boolean;
}

export class TestEmailDto {
  @IsOptional()
  @IsString()
  @MaxLength(254)
  recipient?: string;
}
