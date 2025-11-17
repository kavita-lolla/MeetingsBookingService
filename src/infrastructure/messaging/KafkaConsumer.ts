import { Kafka, Consumer, EachMessagePayload } from 'kafkajs';
import { config } from '../../config';
import { logger } from '../logging/Logger';
import { CacheService } from '../../application/services/CacheService';

export class KafkaConsumer {
  private static instance: KafkaConsumer;
  private kafka: Kafka;
  private consumer: Consumer;
  private isConnected: boolean = false;
  private cacheService: CacheService;

  private constructor() {
    this.kafka = new Kafka({
      clientId: config.kafka.clientId,
      brokers: config.kafka.brokers,
      retry: {
        initialRetryTime: 300,
        retries: 8,
      },
    });
    this.consumer = this.kafka.consumer({ groupId: config.kafka.groupId });
    this.cacheService = CacheService.getInstance();
  }

  public static getInstance(): KafkaConsumer {
    if (!KafkaConsumer.instance) {
      KafkaConsumer.instance = new KafkaConsumer();
    }
    return KafkaConsumer.instance;
  }

  public async connect(): Promise<void> {
    if (this.isConnected) {
      return;
    }

    try {
      await this.consumer.connect();
      this.isConnected = true;
      logger.info('Kafka consumer connected');
    } catch (error) {
      logger.error('Failed to connect Kafka consumer', error);
      throw error;
    }
  }

  public async subscribe(): Promise<void> {
    if (!this.isConnected) {
      await this.connect();
    }

    try {
      await this.consumer.subscribe({
        topic: config.kafka.topicBookings,
        fromBeginning: false,
      });
      logger.info(`Subscribed to topic: ${config.kafka.topicBookings}`);
    } catch (error) {
      logger.error('Failed to subscribe to topic', error);
      throw error;
    }
  }

  public async startConsuming(): Promise<void> {
    await this.subscribe();

    await this.consumer.run({
      eachMessage: async (payload: EachMessagePayload) => {
        await this.handleMessage(payload);
      },
    });

    logger.info('Kafka consumer started consuming messages');
  }

  private async handleMessage(payload: EachMessagePayload): Promise<void> {
    const { topic, partition, message } = payload;

    try {
      const value = message.value?.toString();
      if (!value) {
        logger.warn('Received empty message');
        return;
      }

      const event = JSON.parse(value);
      logger.debug('Processing Kafka message', { topic, partition, event });

      switch (event.eventType) {
        case 'BOOKING_CREATED':
          await this.handleBookingCreated(event.data);
          break;
        default:
          logger.warn('Unknown event type', { eventType: event.eventType });
      }
    } catch (error) {
      logger.error('Error processing Kafka message', { topic, partition, error });
    }
  }

  private async handleBookingCreated(data: any): Promise<void> {
    try {
      await this.cacheService.addMeetingToCache(data);
      logger.info('Meeting added to cache via Kafka event', {
        meetingId: data.id,
        resourceId: data.resourceId,
      });
    } catch (error) {
      logger.error('Error handling booking created event', { data, error });
    }
  }

  public async disconnect(): Promise<void> {
    if (!this.isConnected) {
      return;
    }

    try {
      await this.consumer.disconnect();
      this.isConnected = false;
      logger.info('Kafka consumer disconnected');
    } catch (error) {
      logger.error('Error disconnecting Kafka consumer', error);
      throw error;
    }
  }
}
