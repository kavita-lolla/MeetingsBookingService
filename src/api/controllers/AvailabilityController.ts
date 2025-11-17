import { Request, Response } from 'express';
import { AvailabilityService } from '../../application/services/AvailabilityService';
import { availabilityQuerySchema, AvailabilityResponseDTO } from '../dto/BookingDTO';
import { logger } from '../../infrastructure/logging/Logger';
import { ZodError } from 'zod';

export class AvailabilityController {
  private static instance: AvailabilityController;
  private availabilityService: AvailabilityService;

  private constructor() {
    this.availabilityService = AvailabilityService.getInstance();
  }

  public static getInstance(): AvailabilityController {
    if (!AvailabilityController.instance) {
      AvailabilityController.instance = new AvailabilityController();
    }
    return AvailabilityController.instance;
  }

  public getAvailability = async (req: Request, res: Response): Promise<void> => {
    try {
      const resourceId = req.params.resource_id;

      // Validate query parameters
      const validatedQuery = availabilityQuerySchema.parse(req.query);

      const startTime = new Date(validatedQuery.start_time);
      const endTime = new Date(validatedQuery.end_time);
      const page = validatedQuery.page;
      const limit = validatedQuery.limit;

      const result = await this.availabilityService.getAvailability(
        resourceId,
        startTime,
        endTime,
        page,
        limit
      );

      const response: AvailabilityResponseDTO = {
        resource_id: resourceId,
        availability: result.availability.map((slot) => ({
          start_time: slot.startTime.toISOString(),
          end_time: slot.endTime.toISOString(),
        })),
        pagination: {
          page: result.page,
          limit: result.limit,
          total: result.total,
          totalPages: Math.ceil(result.total / result.limit),
        },
      };

      res.status(200).json(response);
    } catch (error) {
      if (error instanceof ZodError) {
        res.status(400).json({
          error: 'validation_error',
          message: 'Invalid query parameters',
          details: error.errors,
        });
        return;
      }

      logger.error('Error in getAvailability controller', error);
      res.status(500).json({
        error: 'internal_error',
        message: 'An error occurred while fetching availability',
      });
    }
  };
}
