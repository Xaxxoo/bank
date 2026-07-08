import { Test, TestingModule } from '@nestjs/testing';
import { BadGatewayException, UnprocessableEntityException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AxiosError } from 'axios';
import { VTPassService } from './vtpass.service';
import { DataNetworkOperator, NetworkOperator } from './vtpass.types';

const mockAxiosInstance = {
  get: jest.fn(),
  post: jest.fn(),
};

jest.mock('axios', () => ({
  default: {
    create: jest.fn(() => mockAxiosInstance),
  },
  create: jest.fn(() => mockAxiosInstance),
  AxiosError: jest.requireActual('axios').AxiosError,
}));

const mockConfig = () => ({
  get: jest.fn((_key: string, def?: any) => def ?? 'mock-value'),
});

const makeAxiosError = (status: number, description: string): AxiosError => {
  const err = new AxiosError('Request failed');
  (err as any).response = { status, data: { response_description: description } };
  return err;
};

const successResponse = {
  code: '000',
  response_description: 'TRANSACTION SUCCESSFUL',
  requestId: 'vt-req-1',
  amount: '1000',
  content: { transactions: { status: 'delivered' } },
};

const failureResponse = {
  code: '099',
  response_description: 'Transaction failed',
  requestId: 'vt-req-2',
  amount: '0',
  content: { transactions: { status: 'failed' } },
};

describe('VTPassService', () => {
  let service: VTPassService;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        VTPassService,
        { provide: ConfigService, useFactory: mockConfig },
      ],
    }).compile();

    service = module.get(VTPassService);
  });

  // ─── purchaseAirtime ──────────────────────────────────────────────────────

  describe('purchaseAirtime', () => {
    it('returns transaction response when VTPass returns code 000', async () => {
      mockAxiosInstance.post.mockResolvedValue({ data: successResponse });

      const result = await service.purchaseAirtime(
        NetworkOperator.MTN,
        '08012345678',
        1000,
        'ref-1',
      );

      expect(result.code).toBe('000');
      expect(mockAxiosInstance.post).toHaveBeenCalledWith(
        '/pay',
        expect.objectContaining({ request_id: 'ref-1', serviceID: NetworkOperator.MTN }),
      );
    });

    it('throws UnprocessableEntityException when VTPass returns a non-000 code', async () => {
      mockAxiosInstance.post.mockResolvedValue({ data: failureResponse });

      await expect(
        service.purchaseAirtime(NetworkOperator.MTN, '08012345678', 1000, 'ref-fail'),
      ).rejects.toBeInstanceOf(UnprocessableEntityException);
    });

    it('throws BadGatewayException on HTTP network error', async () => {
      mockAxiosInstance.post.mockRejectedValue(makeAxiosError(503, 'Service unavailable'));

      await expect(
        service.purchaseAirtime(NetworkOperator.AIRTEL, '08012345678', 500, 'ref-err'),
      ).rejects.toBeInstanceOf(BadGatewayException);
    });

    it('throws BadGatewayException on non-Axios error', async () => {
      mockAxiosInstance.post.mockRejectedValue(new Error('Network failure'));

      await expect(
        service.purchaseAirtime(NetworkOperator.GLO, '08012345678', 200, 'ref-net'),
      ).rejects.toBeInstanceOf(BadGatewayException);
    });

    it('passes billersCode equal to phone for airtime', async () => {
      mockAxiosInstance.post.mockResolvedValue({ data: successResponse });

      await service.purchaseAirtime(NetworkOperator.MTN, '08012345678', 1000, 'ref-1');

      const payload = mockAxiosInstance.post.mock.calls[0][1];
      expect(payload.billersCode).toBe(payload.phone);
    });
  });

  // ─── getDataBundles ───────────────────────────────────────────────────────

  describe('getDataBundles', () => {
    it('returns bundle list from VTPass', async () => {
      const bundles = [
        { variation_code: 'mtn-1gb', name: '1GB', variation_amount: '300', fixedPrice: 'Yes' },
        { variation_code: 'mtn-2gb', name: '2GB', variation_amount: '500', fixedPrice: 'Yes' },
      ];
      mockAxiosInstance.get.mockResolvedValue({ data: { content: { varations: bundles } } });

      const result = await service.getDataBundles(DataNetworkOperator.MTN_DATA);

      expect(result).toEqual(bundles);
      expect(mockAxiosInstance.get).toHaveBeenCalledWith(
        `/service-variations?serviceID=${DataNetworkOperator.MTN_DATA}`,
      );
    });

    it('returns empty array when varations field is missing', async () => {
      mockAxiosInstance.get.mockResolvedValue({ data: { content: {} } });

      const result = await service.getDataBundles(DataNetworkOperator.AIRTEL_DATA);
      expect(result).toEqual([]);
    });

    it('throws BadGatewayException on HTTP error', async () => {
      mockAxiosInstance.get.mockRejectedValue(makeAxiosError(500, 'Internal error'));

      await expect(
        service.getDataBundles(DataNetworkOperator.GLO_DATA),
      ).rejects.toBeInstanceOf(BadGatewayException);
    });
  });

  // ─── purchaseData ─────────────────────────────────────────────────────────

  describe('purchaseData', () => {
    it('returns transaction response on success', async () => {
      mockAxiosInstance.post.mockResolvedValue({ data: successResponse });

      const result = await service.purchaseData(
        DataNetworkOperator.MTN_DATA,
        '08012345678',
        'mtn-1gb',
        300,
        'ref-data-1',
      );

      expect(result.code).toBe('000');
      expect(mockAxiosInstance.post).toHaveBeenCalledWith(
        '/pay',
        expect.objectContaining({
          request_id: 'ref-data-1',
          serviceID: DataNetworkOperator.MTN_DATA,
          variation_code: 'mtn-1gb',
        }),
      );
    });

    it('throws UnprocessableEntityException when VTPass returns failure code', async () => {
      mockAxiosInstance.post.mockResolvedValue({ data: failureResponse });

      await expect(
        service.purchaseData(
          DataNetworkOperator.MTN_DATA,
          '08012345678',
          'mtn-1gb',
          300,
          'ref-fail',
        ),
      ).rejects.toBeInstanceOf(UnprocessableEntityException);
    });

    it('throws BadGatewayException on HTTP error', async () => {
      mockAxiosInstance.post.mockRejectedValue(makeAxiosError(502, 'Bad gateway'));

      await expect(
        service.purchaseData(
          DataNetworkOperator.AIRTEL_DATA,
          '08012345678',
          'airtel-1gb',
          300,
          'ref-err',
        ),
      ).rejects.toBeInstanceOf(BadGatewayException);
    });
  });
});
