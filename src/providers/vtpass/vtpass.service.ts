import {
  Injectable,
  Logger,
  BadGatewayException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosInstance, AxiosError } from 'axios';
import {
  VTPassAirtimeRequest,
  VTPassDataRequest,
  VTPassDataBundle,
  VTPassTransactionResponse,
  VTPassDataBundlesResponse,
  NetworkOperator,
  DataNetworkOperator,
} from './vtpass.types';

@Injectable()
export class VTPassService {
  private readonly logger = new Logger(VTPassService.name);
  private readonly http: AxiosInstance;

  constructor(private readonly config: ConfigService) {
    this.http = axios.create({
      baseURL: config.get<string>('VTPASS_BASE_URL', 'https://sandbox.vtpass.com/api'),
      auth: {
        username: config.get<string>('VTPASS_USERNAME', ''),
        password: config.get<string>('VTPASS_PASSWORD', ''),
      },
      headers: {
        'api-key': config.get<string>('VTPASS_API_KEY', ''),
        'Content-Type': 'application/json',
      },
      timeout: 30000,
    });
  }

  // ─── Airtime ──────────────────────────────────────────────────────────────

  async purchaseAirtime(
    operator: NetworkOperator,
    phone: string,
    amount: number,
    reference: string,
  ): Promise<VTPassTransactionResponse> {
    const payload: VTPassAirtimeRequest = {
      request_id: reference,
      serviceID: operator,
      amount,
      phone,
      billersCode: phone,
    };

    try {
      const response = await this.http.post<VTPassTransactionResponse>('/pay', payload);
      this.assertSuccess(response.data, reference);
      this.logger.log(`Airtime purchase successful: ${reference} | ${operator} | ₦${amount}`);
      return response.data;
    } catch (err) {
      if (err instanceof UnprocessableEntityException) throw err;
      this.handleVTPassError(err, 'purchaseAirtime');
    }
  }

  // ─── Data Bundles ─────────────────────────────────────────────────────────

  async getDataBundles(operator: DataNetworkOperator): Promise<VTPassDataBundle[]> {
    try {
      const response = await this.http.get<VTPassDataBundlesResponse>(
        `/service-variations?serviceID=${operator}`,
      );
      return response.data.content.varations ?? [];
    } catch (err) {
      this.handleVTPassError(err, 'getDataBundles');
    }
  }

  // ─── Data Purchase ────────────────────────────────────────────────────────

  async purchaseData(
    operator: DataNetworkOperator,
    phone: string,
    variationCode: string,
    amount: number,
    reference: string,
  ): Promise<VTPassTransactionResponse> {
    const payload: VTPassDataRequest = {
      request_id: reference,
      serviceID: operator,
      billersCode: phone,
      variation_code: variationCode,
      amount,
      phone,
    };

    try {
      const response = await this.http.post<VTPassTransactionResponse>('/pay', payload);
      this.assertSuccess(response.data, reference);
      this.logger.log(`Data purchase successful: ${reference} | ${operator} | ${variationCode}`);
      return response.data;
    } catch (err) {
      if (err instanceof UnprocessableEntityException) throw err;
      this.handleVTPassError(err, 'purchaseData');
    }
  }

  // ─── Private Helpers ──────────────────────────────────────────────────────

  /**
   * VTPass returns HTTP 200 even for failures.
   * We must inspect the `code` field to determine real outcome.
   * '000' = success, anything else = failure.
   */
  private assertSuccess(response: VTPassTransactionResponse, reference: string): void {
    if (response.code !== '000') {
      this.logger.warn(
        `VTPass transaction failed: ${reference} | code: ${response.code} | ${response.response_description}`,
      );
      throw new UnprocessableEntityException(
        response.response_description ?? 'VAS transaction failed',
      );
    }
  }

  private handleVTPassError(err: unknown, operation: string): never {
    if (err instanceof AxiosError) {
      const detail = err.response?.data?.response_description ?? err.message;
      this.logger.error(`VTPass ${operation} failed [${err.response?.status}]: ${detail}`);
      throw new BadGatewayException(`VAS provider error: ${detail}`);
    }

    this.logger.error(`VTPass ${operation} unexpected error`, err);
    throw new BadGatewayException('VAS provider unavailable');
  }
}
