import cron from 'node-cron';
import { CacheService } from '../../application/services/CacheService';
import { logger } from '../logging/Logger';

export class CacheScheduler {
  private static instance: CacheScheduler;
  private cacheService: CacheService;
  private dailyCacheJob?: cron.ScheduledTask;

  private constructor() {
    this.cacheService = CacheService.getInstance();
  }

  public static getInstance(): CacheScheduler {
    if (!CacheScheduler.instance) {
      CacheScheduler.instance = new CacheScheduler();
    }
    return CacheScheduler.instance;
  }

  public start(): void {
    // Schedule cache population for 30th day at 11:30 PM every day
    // Cron format: minute hour day month dayOfWeek
    this.dailyCacheJob = cron.schedule('30 23 * * *', async () => {
      logger.info('Running scheduled cache population for 30th day');
      try {
        await this.cacheService.populateCacheFor30thDay();
        logger.info('Scheduled cache population for 30th day completed successfully');
      } catch (error) {
        logger.error('Error in scheduled cache population for 30th day', error);
      }
    });

    logger.info('Cache scheduler started - will populate 30th day cache at 11:30 PM daily');
  }

  public stop(): void {
    if (this.dailyCacheJob) {
      this.dailyCacheJob.stop();
      logger.info('Cache scheduler stopped');
    }
  }

  public async runImmediately(): Promise<void> {
    logger.info('Manual cache population triggered');
    try {
      await this.cacheService.populateCache();
      logger.info('Manual cache population completed successfully');
    } catch (error) {
      logger.error('Error in manual cache population', error);
      throw error;
    }
  }
}
