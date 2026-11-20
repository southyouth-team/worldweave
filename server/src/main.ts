import { ValidationPipe, RequestMethod } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { ConfigService } from '@nestjs/config';
import { json, urlencoded } from 'express';

async function bootstrap() {
  // Nest 默认 Express JSON parser 上限为 100 KiB；空间编辑文档和发布快照都可能较大。
  // 发布快照上限 25 MiB，再加上 base64 缩略图与 JSON 包装，统一放宽到 30 MiB；
  // ScenesService 仍会按自己的 15 MiB 业务上限做二次校验。
  const app = await NestFactory.create(AppModule, { bodyParser: false });
  app.use(json({ limit: '30mb' }));
  app.use(urlencoded({ extended: true, limit: '1mb' }));
  const config = app.get(ConfigService);

  app.setGlobalPrefix(config.get<string>('API_PREFIX', 'api/v1'), {
    exclude: [
      { path: 'health', method: RequestMethod.GET },
      { path: 'ready', method: RequestMethod.GET },
    ],
  });
  app.enableCors({
    origin: config.get<string>('CORS_ORIGIN', 'http://localhost:5173')
      .split(',')
      .map((value) => value.trim()),
    credentials: true,
  });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  if (config.get<string>('NODE_ENV') !== 'production') {
    const swaggerConfig = new DocumentBuilder()
      .setTitle('Worldweave API')
      .setDescription('Source-available AI world builder API')
      .setVersion('1.0')
      .build();
    SwaggerModule.setup('api/docs', app, SwaggerModule.createDocument(app, swaggerConfig));
  }

  await app.listen(Number(config.get<string>('PORT', '3001')), '0.0.0.0');
}
void bootstrap();
