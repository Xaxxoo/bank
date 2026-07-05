import {
  CanActivate,
  ExecutionContext,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthService } from '../auth.service';
import { PERMISSIONS_KEY } from '../decorators/auth.decorator';

/**
 * API Key Guard
 *
 * Validates the x-api-key header for read operations:
 *   GET /accounts/:account_number/balance
 *   GET /accounts/:account_number
 *
 * Attaches the resolved ApiClient to request.apiClient for use in controllers.
 */
@Injectable()
export class ApiKeyGuard implements CanActivate {
  constructor(
    private readonly authService: AuthService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const apiKey = request.headers['x-api-key'];

    const client = await this.authService.validateApiKey(apiKey);
    request.apiClient = client;

    // Check required permissions if set on the route via @RequirePermissions()
    const requiredPermissions = this.reflector.get<string[]>(
      PERMISSIONS_KEY,
      context.getHandler(),
    );

    if (requiredPermissions?.length) {
      for (const permission of requiredPermissions) {
        this.authService.assertPermission(client, permission);
      }
    }

    return true;
  }
}
