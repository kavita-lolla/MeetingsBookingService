import express, { Application, Request, Response, NextFunction } from 'express';
import 'express-async-errors';
import { config } from './config';
import { logger } from './infrastructure/logging/Logger';
import { DatabaseClient } from './infrastructure/database/DatabaseClient';
import { RedisClient } from './infrastructure/cache/RedisClient';
import { KafkaProducer } from './infrastructure/messaging/KafkaProducer';
import { KafkaConsumer } from './infrastructure/messaging/KafkaConsumer';
import { CacheService } from './application/services/CacheService';
import { CacheScheduler } from './infrastructure/scheduler/CacheScheduler';
import routes from './api/routes';

class MeetingsBookingApp {
  private app: Application;
  private db: DatabaseClient;
  private redis: RedisClient;
  private kafkaProducer: KafkaProducer;
  private kafkaConsumer: KafkaConsumer;
  private cacheService: CacheService;
  private cacheScheduler: CacheScheduler;

  constructor() {
    this.app = express();
    this.db = DatabaseClient.getInstance();
    this.redis = RedisClient.getInstance();
    this.kafkaProducer = KafkaProducer.getInstance();
    this.kafkaConsumer = KafkaConsumer.getInstance();
    this.cacheService = CacheService.getInstance();
    this.cacheScheduler = CacheScheduler.getInstance();

    this.setupMiddleware();
    this.setupRoutes();
    this.setupErrorHandling();
  }

  private setupMiddleware(): void {
    this.app.use(express.json());
    this.app.use(express.urlencoded({ extended: true }));

    // Request logging
    this.app.use((req: Request, res: Response, next: NextFunction) => {
      logger.info('Incoming request', {
        method: req.method,
        path: req.path,
        query: req.query,
      });
      next();
    });
  }

  private setupRoutes(): void {
    this.app.use('/api', routes);
  }

  private setupErrorHandling(): void {
    // 404 handler
    this.app.use((req: Request, res: Response) => {
      res.status(404).json({
        error: 'not_found',
        message: 'Route not found',
      });
    });

    // Global error handler
    this.app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
      logger.error('Unhandled error', err);
      res.status(500).json({
        error: 'internal_error',
        message: 'An unexpected error occurred',
      });
    });
  }

  private async initializeInfrastructure(): Promise<void> {
    logger.info('Initializing infrastructure...');

    // Check database connection
    const dbHealthy = await this.db.healthCheck();
    if (!dbHealthy) {
      throw new Error('Database health check failed');
    }
    logger.info('Database connection established');

    // Check Redis connection
    const redisHealthy = await this.redis.healthCheck();
    if (!redisHealthy) {
      logger.warn('Redis connection failed - will fallback to database');
    } else {
      logger.info('Redis connection established');
    }

    // Connect Kafka producer
    try {
      await this.kafkaProducer.connect();
      logger.info('Kafka producer connected');
    } catch (error) {
      logger.error('Failed to connect Kafka producer', error);
      throw error;
    }

    // Connect and start Kafka consumer
    try {
      await this.kafkaConsumer.startConsuming();
      logger.info('Kafka consumer started');
    } catch (error) {
      logger.error('Failed to start Kafka consumer', error);
      throw error;
    }

    // Populate cache
    if (redisHealthy) {
      try {
        await this.cacheService.populateCache();
        logger.info('Initial cache population completed');
      } catch (error) {
        logger.error('Failed to populate cache', error);
        // Don't throw - cache population failure shouldn't prevent startup
      }
    }

    // Start cache scheduler
    this.cacheScheduler.start();
    logger.info('Cache scheduler started');

    logger.info('Infrastructure initialization completed');
  }

  public async start(): Promise<void> {
    try {
      await this.initializeInfrastructure();

      const port = config.app.port;
      this.app.listen(port, () => {
        logger.info(`Server started on port ${port}`, {
          environment: config.app.nodeEnv,
          port,
        });
      });
    } catch (error) {
      logger.error('Failed to start application', error);
      await this.shutdown();
      process.exit(1);
    }
  }

  private async shutdown(): Promise<void> {
    logger.info('Shutting down application...');

    try {
      this.cacheScheduler.stop();
      await this.kafkaConsumer.disconnect();
      await this.kafkaProducer.disconnect();
      await this.redis.close();
      await this.db.close();
      logger.info('Application shutdown complete');
    } catch (error) {
      logger.error('Error during shutdown', error);
    }
  }

  public setupGracefulShutdown(): void {
    process.on('SIGTERM', async () => {
      logger.info('SIGTERM signal received');
      await this.shutdown();
      process.exit(0);
    });

    process.on('SIGINT', async () => {
      logger.info('SIGINT signal received');
      await this.shutdown();
      process.exit(0);
    });

    process.on('uncaughtException', (error: Error) => {
      logger.error('Uncaught exception', error);
      this.shutdown().then(() => process.exit(1));
    });

    process.on('unhandledRejection', (reason: any) => {
      logger.error('Unhandled rejection', reason);
      this.shutdown().then(() => process.exit(1));
    });
  }
}

// Start application
const app = new MeetingsBookingApp();
app.setupGracefulShutdown();
app.start();
