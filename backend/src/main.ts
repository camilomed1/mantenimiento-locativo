import { Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { CONFIGURACION, Configuracion } from './config/configuracion';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  const config = app.get<Configuracion>(CONFIGURACION);

  app.setGlobalPrefix('api');
  app.enableCors({ origin: config.corsOrigenes, credentials: false });
  app.enableShutdownHooks();
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  const swagger = new DocumentBuilder()
    .setTitle('Mantenimiento Locativo API')
    .setDescription('Attendance and Execution/Evidence modules (offline-first sync)')
    .setVersion('0.1.0')
    .addBearerAuth()
    .build();
  SwaggerModule.setup('api/docs', app, SwaggerModule.createDocument(app, swagger));

  await app.listen(config.puerto);
  new Logger('Bootstrap').log(`API on http://localhost:${config.puerto}/api (docs: /api/docs)`);
}

void bootstrap();
