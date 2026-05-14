import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { execSync } from 'child_process';
import { Logger } from '@nestjs/common';

const logger = new Logger('Bootstrap');

async function runMigrations(retries = 5, delayMs = 3000) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      execSync('npx prisma migrate deploy', { stdio: 'inherit' });
      logger.log('Database migrations applied');
      return;
    } catch (e) {
      logger.error(`Migration attempt ${attempt}/${retries} failed: ${e.message}`);
      if (attempt === retries) {
        logger.error('All migration attempts exhausted. Exiting.');
        process.exit(1);
      }
      await new Promise((res) => setTimeout(res, delayMs));
    }
  }
}

async function bootstrap() {
  await runMigrations();

  const app = await NestFactory.create(AppModule);
  app.enableCors({ origin: '*' });
  app.setGlobalPrefix('api/v1');

  const port = parseInt(process.env.APP_PORT || '8000', 10); 
  await app.listen(port);
  logger.log(`Application running on port ${port}`);
}

bootstrap();
