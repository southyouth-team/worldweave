import { IsObject, IsOptional, IsString, MaxLength } from 'class-validator';

export class CreatePublishRequestDto {
  @IsObject() snapshot: Record<string, unknown>;
  @IsOptional() @IsString() @MaxLength(1000) note?: string;
  @IsOptional() @IsString() @MaxLength(700000) thumbnailDataUrl?: string;
}

export class RejectPublishRequestDto {
  @IsOptional() @IsString() @MaxLength(1000) note?: string;
}
