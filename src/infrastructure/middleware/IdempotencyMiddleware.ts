import { Request, Response, NextFunction } from 'express';
import { DatabaseClient } from '../database/DatabaseClient';
import { logger } from '../logging/Logger';
import { config } from '../../config';
import crypto from 'crypto';

export class IdempotencyMiddleware {
  private static instance: IdempotencyMiddleware;
  private db: DatabaseClient;

  private constructor() {
    this.db = DatabaseClient.getInstance();
  }

  public static getInstance(): IdempotencyMiddleware {
    if (!IdempotencyMiddleware.instance) {
      IdempotencyMiddleware.instance = new IdempotencyMiddleware();
    }
    return IdempotencyMiddleware.instance;
  }

  public handle = async (
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    const idempotencyKey = req.headers['idempotency-key'] as string;

    if (!idempotencyKey) {
      res.status(400).json({
        error: 'bad_request',
        message: 'Idempotency-Key header is required',
      });
      return;
    }

    try {
      // Create a hash of the request body
      const requestHash = this.hashRequest(req.body);

      // Check if this idempotency key exists
      const existingResult = await this.db.query(
        `SELECT response_status, response_body, request_hash
         FROM idempotency_keys
         WHERE idempotency_key = $1 AND expires_at > NOW()`,
        [idempotencyKey]
      );

      if (existingResult.rows.length > 0) {
        const existing = existingResult.rows[0];

        // Verify the request is identical
        if (existing.request_hash !== requestHash) {
          res.status(422).json({
            error: 'idempotency_key_mismatch',
            message: 'Idempotency key has been used with a different request',
          });
          return;
        }

        // Return cached response
        logger.info('Returning cached response for idempotency key', {
          idempotencyKey,
        });

        res.status(existing.response_status).json(existing.response_body);
        return;
      }

      // Store the idempotency key and request hash
      const expiresAt = new Date(
        Date.now() + config.idempotency.keyTtlHours * 60 * 60 * 1000
      );

      await this.db.query(
        `INSERT INTO idempotency_keys (idempotency_key, request_hash, expires_at)
         VALUES ($1, $2, $3)
         ON CONFLICT (idempotency_key) DO NOTHING`,
        [idempotencyKey, requestHash, expiresAt]
      );

      // Store original send function
      const originalSend = res.send.bind(res);

      // Override send to capture response
      res.send = function (body: any): Response {
        // Only store successful responses
        if (res.statusCode >= 200 && res.statusCode < 300) {
          // Store response asynchronously (don't wait)
          IdempotencyMiddleware.getInstance()
            .storeResponse(idempotencyKey, res.statusCode, body)
            .catch((error) => {
              logger.error('Error storing idempotency response', error);
            });
        }

        // Call original send
        return originalSend(body);
      };

      next();
    } catch (error) {
      logger.error('Error in idempotency middleware', error);
      next(error);
    }
  };

  private hashRequest(body: any): string {
    const bodyString = JSON.stringify(body);
    return crypto.createHash('sha256').update(bodyString).digest('hex');
  }

  private async storeResponse(
    idempotencyKey: string,
    status: number,
    body: any
  ): Promise<void> {
    try {
      const responseBody = typeof body === 'string' ? JSON.parse(body) : body;

      await this.db.query(
        `UPDATE idempotency_keys
         SET response_status = $1, response_body = $2
         WHERE idempotency_key = $3`,
        [status, responseBody, idempotencyKey]
      );
    } catch (error) {
      logger.error('Error storing idempotency response', error);
    }
  }
}
