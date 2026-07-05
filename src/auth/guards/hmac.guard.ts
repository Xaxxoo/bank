import {
  CanActivate,
  ExecutionContext,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthService } from '../auth.service';
import { PERMISSIONS_KEY } from '../decorators/auth.decorator';

/**
 * HMAC Signature Guard
 *
 * Validates the three-header HMAC scheme for write operations:
 *   POST /accounts/prefix  (create sub-account)
 *   GET  /vas/data/bundles (sensitive read)
 *
 * Required headers:
 *   x-public-key  — client's public key (identifies the API client)
 *   x-signature   — HMAC-SHA256(timestamp + rawBody, privateKey)
 *   x-timestamp   — Unix ms timestamp (prevents replay attacks)
 *
 * Client-side signing example (JavaScript):
 *   const timestamp = Date.now().toString();
 *   const payload   = JSON.stringify(requestBody);
 *   const message   = timestamp + payload;
 *   const signature = crypto.createHmac('sha256', privateKey).update(message).digest('hex');
 */
@Injectable()
export class HmacGuard implements CanActivate {
  constructor(
    private readonly authService: AuthService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();

    const publicKey = request.headers['x-public-key'] as string;
    const signature = request.headers['x-signature'] as string;
    const timestamp = request.headers['x-timestamp'] as string;

    // Raw body must be captured before any JSON parsing transforms it.
    // We store it via the rawBody middleware configured in main.ts.
    const rawBody: string = request.rawBody ?? JSON.stringify(request.body) ?? '';

    const client = await this.authService.validateHmacSignature(
      publicKey,
      signature,
      timestamp,
      rawBody,
    );

    request.apiClient = client;

    // Permission check
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
