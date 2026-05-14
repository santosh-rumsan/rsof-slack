import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { execSync } from 'child_process';
import { Logger } from '@nestjs/common';

const logger = new Logger('Bootstrap');

async function bootstrap() {
  // Run DB migrations before starting the app
  try {
    execSync('npx prisma migrate deploy', { stdio: 'inherit' });
    logger.log('Database migrations applied');
  } catch (e) {
    logger.error('Migration failed: ' + e.message);
    process.exit(1);
  }

  const app = await NestFactory.create(AppModule);
  app.enableCors({ origin: '*' });
  app.setGlobalPrefix('api/v1');

  const port = parseInt(process.env.APP_PORT || '8000', 10);
  await app.listen(port);
  logger.log(`Application running on port ${port}`);
}

bootstrap();
