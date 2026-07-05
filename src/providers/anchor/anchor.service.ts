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
  AnchorNameEnquiryRequest,
  AnchorNameEnquiryResult,
  AnchorInitiateTransferRequest,
  AnchorTransfer,
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

  // ─── Name Enquiry ─────────────────────────────────────────────────────────

  /**
   * Resolves an account name before a transfer is initiated.
   * Routes through Anchor → NIBSS NIP name enquiry service.
   */
  async nameEnquiry(
    accountNumber: string,
    bankCode: string,
  ): Promise<AnchorNameEnquiryResult> {
    const payload: AnchorNameEnquiryRequest = {
      data: {
        type: 'NameEnquiry',
        attributes: { accountNumber, bankCode },
      },
    };

    try {
      const response = await this.http.post<AnchorApiResponse<AnchorNameEnquiryResult>>(
        '/transfers/name-enquiry',
        payload,
      );
      return response.data.data;
    } catch (err) {
      this.handleAnchorError(err, 'nameEnquiry');
    }
  }

  // ─── Transfers ────────────────────────────────────────────────────────────

  /**
   * Initiates an inter-bank transfer via NIBSS NIP through Anchor.
   * amount must be in kobo.
   */
  async initiateTransfer(
    sourceAnchorAccountId: string,
    destinationAccountNumber: string,
    destinationBankCode: string,
    amountKobo: number,
    narration: string,
    reference: string,
  ): Promise<AnchorTransfer> {
    const payload: AnchorInitiateTransferRequest = {
      data: {
        type: 'NIPTransfer',
        attributes: {
          amount: amountKobo,
          currency: 'NGN',
          narration,
          destinationAccountNumber,
          destinationBankCode,
          reference,
        },
        relationships: {
          sourceAccount: {
            data: { type: 'DepositAccount', id: sourceAnchorAccountId },
          },
        },
      },
    };

    try {
      const response = await this.http.post<AnchorApiResponse<AnchorTransfer>>(
        '/transfers',
        payload,
      );
      this.logger.log(
        `Anchor transfer initiated: ${response.data.data.id} | ref: ${reference}`,
      );
      return response.data.data;
    } catch (err) {
      this.handleAnchorError(err, 'initiateTransfer');
    }
  }

  /**
   * Fetches the current status of a transfer from Anchor.
   * Used to reconcile transfers that were left in PENDING/PROCESSING state.
   */
  async getTransfer(anchorTransferId: string): Promise<AnchorTransfer> {
    try {
      const response = await this.http.get<AnchorApiResponse<AnchorTransfer>>(
        `/transfers/${anchorTransferId}`,
      );
      return response.data.data;
    } catch (err) {
      this.handleAnchorError(err, 'getTransfer');
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
