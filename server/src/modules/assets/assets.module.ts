import { Module } from '@nestjs/common';
import { DevIdentityGuard } from '../../common/dev-identity.guard';
import { AssetsController } from './assets.controller';
import { AssetsService } from './assets.service';
import { RecognitionService } from './recognition.service';
import { ImageGenerationController } from './image-generation.controller';
import { ImageGenerationService } from './image-generation.service';
import { VisualAssetsController } from './visual-assets.controller';
import { ProceduralAssetsController } from './procedural-assets.controller';
import { BuildingDesignController } from './building-design.controller';
import { BuildingTemplatesController } from './building-templates.controller';
import { BuildingDesignService } from './building-design.service';
import { BuildingTemplatesService } from './building-templates.service';
import { HomepageSnapshotController } from './homepage-snapshot.controller';
import { HomepageSnapshotService } from './homepage-snapshot.service';

@Module({
  controllers: [AssetsController, ImageGenerationController, VisualAssetsController, ProceduralAssetsController, BuildingDesignController, BuildingTemplatesController, HomepageSnapshotController],
  providers: [AssetsService, RecognitionService, ImageGenerationService, BuildingDesignService, BuildingTemplatesService, HomepageSnapshotService, DevIdentityGuard],
  exports: [HomepageSnapshotService],
})
export class AssetsModule {}
