import { Kafka, Producer, ProducerRecord } from 'kafkajs';
import { config } from '../../config';
import { logger } from '../logging/Logger';

export class KafkaProducer {
  private static instance: KafkaProducer;
  private kafka: Kafka;
  private producer: Producer;
  private isConnected: boolean = false;

  private constructor() {
    this.kafka = new Kafka({
      clientId: config.kafka.clientId,
      brokers: config.kafka.brokers,
      retry: {
        initialRetryTime: 300,
        retries: 8,
      },
    });
    this.producer = this.kafka.producer();
  }

  public static getInstance(): KafkaProducer {
    if (!KafkaProducer.instance) {
      KafkaProducer.instance = new KafkaProducer();
    }
    return KafkaProducer.instance;
  }

  public async connect(): Promise<void> {
    if (this.isConnected) {
      return;
    }

    try {
      await this.producer.connect();
      this.isConnected = true;
      logger.info('Kafka producer connected');
    } catch (error) {
      logger.error('Failed to connect Kafka producer', error);
      throw error;
    }
  }

  public async sendMessage(
    topic: string,
    messages: Array<{ key?: string; value: string }>
  ): Promise<void> {
    if (!this.isConnected) {
      await this.connect();
    }

    try {
      const record: ProducerRecord = {
        topic,
        messages,
      };

      await this.producer.send(record);
      logger.debug('Message sent to Kafka', { topic, messageCount: messages.length });
    } catch (error) {
      logger.error('Failed to send message to Kafka', { topic, error });
      throw error;
    }
  }

  public async publishBookingEvent(eventData: any): Promise<void> {
    const message = {
      key: eventData.resourceId,
      value: JSON.stringify({
        eventType: 'BOOKING_CREATED',
        timestamp: new Date().toISOString(),
        data: eventData,
      }),
    };

    await this.sendMessage(config.kafka.topicBookings, [message]);
  }

  public async disconnect(): Promise<void> {
    if (!this.isConnected) {
      return;
    }

    try {
      await this.producer.disconnect();
      this.isConnected = false;
      logger.info('Kafka producer disconnected');
    } catch (error) {
      logger.error('Error disconnecting Kafka producer', error);
      throw error;
    }
  }
}
