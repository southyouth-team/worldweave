import {
  ArrayMaxSize,
  IsArray,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class AcquireLocksDto {
  @IsArray()
  @ArrayMaxSize(2500)
  @IsString({ each: true })
  chunkKeys: string[];

  @IsOptional()
  @IsInt()
  @Min(15)
  @Max(300)
  leaseSeconds?: number;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  currentChunk?: string;
}

export class HeartbeatLocksDto {
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(2500)
  @IsString({ each: true })
  chunkKeys?: string[];

  @IsOptional()
  @IsInt()
  @Min(15)
  @Max(300)
  leaseSeconds?: number;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  currentChunk?: string;
}

export class ReleaseLocksDto {
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(2500)
  @IsString({ each: true })
  chunkKeys?: string[];

  @IsOptional()
  @IsString()
  @MaxLength(40)
  currentChunk?: string;
}

export class SaveWorkspaceDto {
  @IsObject()
  snapshot: Record<string, unknown>;

  @IsObject()
  expectedVersions: Record<string, number>;

  @IsArray()
  @ArrayMaxSize(2500)
  @IsString({ each: true })
  changedChunks: string[];
}

export class ForceUnlockDto {
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(2500)
  @IsString({ each: true })
  chunkKeys?: string[];
}

export class PresenceDto {
  @IsOptional()
  @IsString()
  @MaxLength(40)
  currentChunk?: string;
}
