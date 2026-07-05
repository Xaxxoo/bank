import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';

export interface StandardResponse<T> {
  statusCode: number;
  message: string;
  data: T;
}

/**
 * Wraps all successful responses in the standard Pulse MFB envelope:
 * { statusCode, message, data }
 *
 * Controllers can return plain objects; this interceptor handles wrapping.
 * If the controller already returns this shape, it passes through unchanged.
 */
@Injectable()
export class ResponseInterceptor<T> implements NestInterceptor<T, StandardResponse<T>> {
  intercept(context: ExecutionContext, next: CallHandler): Observable<StandardResponse<T>> {
    const statusCode = context.switchToHttp().getResponse().statusCode;

    return next.handle().pipe(
      map((data) => {
        // Already wrapped — pass through
        if (data && typeof data === 'object' && 'statusCode' in data && 'data' in data) {
          return data;
        }

        return {
          statusCode,
          message: 'Success',
          data,
        };
      }),
    );
  }
}
