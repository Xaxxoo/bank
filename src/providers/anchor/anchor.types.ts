// ─── Anchor API Request / Response Types ─────────────────────────────────────
// Based on Anchor's sandbox API (https://docs.getanchor.co)

export interface AnchorCreateCustomerRequest {
  data: {
    type: 'IndividualCustomer';
    attributes: {
      fullName: string;
      email: string;
      phoneNumber: string; // E.164 format: +234XXXXXXXXXX
      bvn: string;
    };
  };
}

export interface AnchorCustomer {
  id: string;
  type: 'IndividualCustomer';
  attributes: {
    fullName: string;
    email: string;
    phoneNumber: string;
    bvn: string;
    status: 'ACTIVE' | 'INACTIVE' | 'SUSPENDED';
    createdAt: string;
  };
}

export interface AnchorCreateDepositAccountRequest {
  data: {
    type: 'DepositAccount';
    attributes: {
      productName: 'SAVINGS' | 'CURRENT';
      currency: 'NGN';
    };
    relationships: {
      customer: {
        data: {
          type: 'IndividualCustomer';
          id: string; // Anchor customer ID
        };
      };
    };
  };
}

export interface AnchorDepositAccount {
  id: string;
  type: 'DepositAccount';
  attributes: {
    accountNumber: string; // 10-digit NUBAN
    accountName: string;
    currency: 'NGN';
    balance: number; // in kobo
    status: 'ACTIVE' | 'INACTIVE' | 'FROZEN';
    productName: 'SAVINGS' | 'CURRENT';
    createdAt: string;
  };
  relationships: {
    customer: { data: { type: string; id: string } };
    bank: { data: { type: string; id: string } };
  };
}

export interface AnchorApiError {
  errors: Array<{
    title: string;
    detail: string;
    status: string;
  }>;
}

export interface AnchorApiResponse<T> {
  data: T;
}
