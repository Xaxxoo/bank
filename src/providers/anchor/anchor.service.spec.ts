import { Test, TestingModule } from '@nestjs/testing';
import { BadGatewayException, ConflictException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AxiosError } from 'axios';
import { AnchorService } from './anchor.service';

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

const makeAxiosError = (status: number, detail: string): AxiosError => {
  const err = new AxiosError('Request failed');
  (err as any).response = { status, data: { errors: [{ detail }] } };
  return err;
};

describe('AnchorService', () => {
  let service: AnchorService;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AnchorService,
        { provide: ConfigService, useFactory: mockConfig },
      ],
    }).compile();

    service = module.get(AnchorService);
  });

  // ─── createCustomer ───────────────────────────────────────────────────────

  describe('createCustomer', () => {
    it('posts to /customers and returns customer data', async () => {
      const customer = { id: 'cust-1', attributes: { fullName: 'John Doe' } };
      mockAxiosInstance.post.mockResolvedValue({ data: { data: customer } });

      const result = await service.createCustomer(
        'John Doe',
        'john@test.com',
        '08012345678',
        '12345678901',
      );

      expect(result).toEqual(customer);
      expect(mockAxiosInstance.post).toHaveBeenCalledWith('/customers', expect.any(Object));
    });

    it('throws ConflictException on 409 response', async () => {
      mockAxiosInstance.post.mockRejectedValue(makeAxiosError(409, 'Duplicate customer'));

      await expect(
        service.createCustomer('John Doe', 'john@test.com', '08012345678', '12345678901'),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('throws BadGatewayException on other HTTP errors', async () => {
      mockAxiosInstance.post.mockRejectedValue(makeAxiosError(503, 'Service unavailable'));

      await expect(
        service.createCustomer('John Doe', 'john@test.com', '08012345678', '12345678901'),
      ).rejects.toBeInstanceOf(BadGatewayException);
    });

    it('throws BadGatewayException on non-Axios errors', async () => {
      mockAxiosInstance.post.mockRejectedValue(new Error('Network error'));

      await expect(
        service.createCustomer('John Doe', 'john@test.com', '08012345678', '12345678901'),
      ).rejects.toBeInstanceOf(BadGatewayException);
    });
  });

  // ─── createDepositAccount ─────────────────────────────────────────────────

  describe('createDepositAccount', () => {
    it('posts to /accounts and returns the deposit account', async () => {
      const account = { id: 'dep-1', attributes: { accountNumber: '0123456789' } };
      mockAxiosInstance.post.mockResolvedValue({ data: { data: account } });

      const result = await service.createDepositAccount('cust-1');

      expect(result).toEqual(account);
      expect(mockAxiosInstance.post).toHaveBeenCalledWith('/accounts', expect.any(Object));
    });

    it('throws BadGatewayException on error', async () => {
      mockAxiosInstance.post.mockRejectedValue(makeAxiosError(500, 'Internal error'));

      await expect(service.createDepositAccount('cust-1')).rejects.toBeInstanceOf(
        BadGatewayException,
      );
    });
  });

  // ─── getDepositAccount ────────────────────────────────────────────────────

  describe('getDepositAccount', () => {
    it('fetches account from /accounts/:id', async () => {
      const account = { id: 'dep-1', attributes: { balance: 100_000 } };
      mockAxiosInstance.get.mockResolvedValue({ data: { data: account } });

      const result = await service.getDepositAccount('dep-1');

      expect(result).toEqual(account);
      expect(mockAxiosInstance.get).toHaveBeenCalledWith('/accounts/dep-1');
    });

    it('throws BadGatewayException when account is not found', async () => {
      mockAxiosInstance.get.mockRejectedValue(makeAxiosError(404, 'Not found'));

      await expect(service.getDepositAccount('not-found')).rejects.toBeInstanceOf(
        BadGatewayException,
      );
    });
  });

  // ─── nameEnquiry ──────────────────────────────────────────────────────────

  describe('nameEnquiry', () => {
    it('posts to /transfers/name-enquiry and returns result', async () => {
      const enquiryResult = { id: 'ne-1', attributes: { accountName: 'Jane Doe' } };
      mockAxiosInstance.post.mockResolvedValue({ data: { data: enquiryResult } });

      const result = await service.nameEnquiry('0987654321', '000016');

      expect(result).toEqual(enquiryResult);
      expect(mockAxiosInstance.post).toHaveBeenCalledWith(
        '/transfers/name-enquiry',
        expect.any(Object),
      );
    });

    it('throws BadGatewayException on invalid account', async () => {
      mockAxiosInstance.post.mockRejectedValue(makeAxiosError(400, 'Invalid account number'));

      await expect(service.nameEnquiry('0000000000', '000016')).rejects.toBeInstanceOf(
        BadGatewayException,
      );
    });
  });

  // ─── initiateTransfer ─────────────────────────────────────────────────────

  describe('initiateTransfer', () => {
    it('posts to /transfers and returns the transfer', async () => {
      const transfer = { id: 'tr-1', attributes: { status: 'PENDING' } };
      mockAxiosInstance.post.mockResolvedValue({ data: { data: transfer } });

      const result = await service.initiateTransfer(
        'anchor-acc-1',
        '0987654321',
        '000016',
        100_000,
        'Test narration',
        'ref-1',
      );

      expect(result).toEqual(transfer);
      expect(mockAxiosInstance.post).toHaveBeenCalledWith('/transfers', expect.any(Object));
    });

    it('throws BadGatewayException on transfer error', async () => {
      mockAxiosInstance.post.mockRejectedValue(makeAxiosError(422, 'Insufficient funds'));

      await expect(
        service.initiateTransfer('acc-1', '0987654321', '000016', 100_000, 'Test', 'ref-1'),
      ).rejects.toBeInstanceOf(BadGatewayException);
    });
  });

  // ─── getTransfer ──────────────────────────────────────────────────────────

  describe('getTransfer', () => {
    it('fetches transfer from /transfers/:id', async () => {
      const transfer = { id: 'tr-1', attributes: { status: 'SUCCESSFUL' } };
      mockAxiosInstance.get.mockResolvedValue({ data: { data: transfer } });

      const result = await service.getTransfer('tr-1');

      expect(result).toEqual(transfer);
      expect(mockAxiosInstance.get).toHaveBeenCalledWith('/transfers/tr-1');
    });

    it('throws BadGatewayException when transfer is not found', async () => {
      mockAxiosInstance.get.mockRejectedValue(makeAxiosError(404, 'Transfer not found'));

      await expect(service.getTransfer('not-found')).rejects.toBeInstanceOf(BadGatewayException);
    });
  });

  // ─── Phone number normalisation (toE164) ─────────────────────────────────

  describe('phone number normalisation', () => {
    it.each([
      ['08012345678', '+2348012345678'],
      ['2348012345678', '+2348012345678'],
      ['+2348012345678', '+2348012345678'],
    ])('converts %s to E.164 format %s', async (input, expected) => {
      mockAxiosInstance.post.mockResolvedValue({ data: { data: { id: 'c-1' } } });

      await service.createCustomer('Test', 'test@test.com', input, '00000000000');

      const body = mockAxiosInstance.post.mock.calls[0][1] as any;
      expect(body.data.attributes.phoneNumber).toBe(expected);
    });
  });
});
