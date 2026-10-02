import { INestApplication, ValidationPipe } from '@nestjs/common';

// Shared by main.ts and the e2e tests so both run the same app configuration.
export function configureApp(app: INestApplication): void {
  app.setGlobalPrefix('api/v1');
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  app.enableShutdownHooks();
}
