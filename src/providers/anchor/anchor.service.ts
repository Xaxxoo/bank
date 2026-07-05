import {
  Injectable,
  Logger,
  BadGatewayException,
  ConflictException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosInstance, AxiosError } from 'axios';
import {
  AnchorCreateCustomerRequest,
  AnchorCreateDepositAccountRequest,
  AnchorCustomer,
  AnchorDepositAccount,
  AnchorApiResponse,
} from './anchor.types';

@Injectable()
export class AnchorService {
  private readonly logger = new Logger(AnchorService.name);
  private readonly http: AxiosInstance;

  constructor(private readonly config: ConfigService) {
    this.http = axios.create({
      baseURL: config.get<string>('ANCHOR_BASE_URL', 'https://api.sandbox.getanchor.co'),
      headers: {
        'x-anchor-key': config.get<string>('ANCHOR_API_KEY'),
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      timeout: 30000,
    });
  }

  // ─── Customer ─────────────────────────────────────────────────────────────

  /**
   * Creates an individual customer on Anchor.
   * Each sub-account belongs to a customer record.
   */
  async createCustomer(
    fullName: string,
    email: string,
    phoneNumber: string,
    bvn: string,
  ): Promise<AnchorCustomer> {
    const payload: AnchorCreateCustomerRequest = {
      data: {
        type: 'IndividualCustomer',
        attributes: { fullName, email, phoneNumber: this.toE164(phoneNumber), bvn },
      },
    };

    try {
      const response = await this.http.post<AnchorApiResponse<AnchorCustomer>>(
        '/customers',
        payload,
      );
      this.logger.log(`Anchor customer created: ${response.data.data.id}`);
      return response.data.data;
    } catch (err) {
      this.handleAnchorError(err, 'createCustomer');
    }
  }

  // ─── Deposit Account ──────────────────────────────────────────────────────

  /**
   * Creates a virtual deposit account (NUBAN) linked to an Anchor customer.
   * This is what gives us the account number we return to the API caller.
   */
  async createDepositAccount(anchorCustomerId: string): Promise<AnchorDepositAccount> {
    const payload: AnchorCreateDepositAccountRequest = {
      data: {
        type: 'DepositAccount',
        attributes: { productName: 'SAVINGS', currency: 'NGN' },
        relationships: {
          customer: {
            data: { type: 'IndividualCustomer', id: anchorCustomerId },
          },
        },
      },
    };

    try {
      const response = await this.http.post<AnchorApiResponse<AnchorDepositAccount>>(
        '/accounts',
        payload,
      );
      this.logger.log(
        `Anchor deposit account created: ${response.data.data.attributes.accountNumber}`,
      );
      return response.data.data;
    } catch (err) {
      this.handleAnchorError(err, 'createDepositAccount');
    }
  }

  /**
   * Fetches live balance from Anchor for a given deposit account.
   * Used as the source of truth for balance queries.
   */
  async getDepositAccount(anchorAccountId: string): Promise<AnchorDepositAccount> {
    try {
      const response = await this.http.get<AnchorApiResponse<AnchorDepositAccount>>(
        `/accounts/${anchorAccountId}`,
      );
      return response.data.data;
    } catch (err) {
      this.handleAnchorError(err, 'getDepositAccount');
    }
  }

  // ─── Error Handling ───────────────────────────────────────────────────────

  private handleAnchorError(err: unknown, operation: string): never {
    if (err instanceof AxiosError) {
      const status = err.response?.status;
      const anchorErrors = err.response?.data?.errors;
      const detail = anchorErrors?.[0]?.detail ?? err.message;

      this.logger.error(`Anchor ${operation} failed [${status}]: ${detail}`);

      // Map Anchor 409 (duplicate customer/account) to NestJS ConflictException
      if (status === 409) throw new ConflictException(`Anchor: ${detail}`);

      throw new BadGatewayException(`Banking provider error: ${detail}`);
    }

    this.logger.error(`Anchor ${operation} unexpected error`, err);
    throw new BadGatewayException('Banking provider unavailable');
  }

  // ─── Helpers ─────────────────────────────────────────────────────────────

  private toE164(phone: string): string {
    // Normalise Nigerian numbers: 08012345678 → +2348012345678
    const digits = phone.replace(/\D/g, '');
    if (digits.startsWith('234')) return `+${digits}`;
    if (digits.startsWith('0')) return `+234${digits.slice(1)}`;
    return `+${digits}`;
  }
}
