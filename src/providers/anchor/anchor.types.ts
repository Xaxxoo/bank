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

// ─── Name Enquiry ─────────────────────────────────────────────────────────────

export interface AnchorNameEnquiryRequest {
  data: {
    type: 'NameEnquiry';
    attributes: {
      accountNumber: string;
      bankCode: string;
    };
  };
}

export interface AnchorNameEnquiryResult {
  accountNumber: string;
  accountName: string;
  bankCode: string;
  responseCode: string;   // '00' = success
  responseMessage: string;
}

// ─── NIP Transfer ─────────────────────────────────────────────────────────────

export interface AnchorInitiateTransferRequest {
  data: {
    type: 'NIPTransfer';
    attributes: {
      amount: number;        // in kobo
      currency: 'NGN';
      narration: string;
      destinationAccountNumber: string;
      destinationBankCode: string;
      reference: string;     // unique per transfer, used for idempotency
    };
    relationships: {
      sourceAccount: {
        data: {
          type: 'DepositAccount';
          id: string;        // Anchor deposit account ID
        };
      };
    };
  };
}

export interface AnchorTransfer {
  id: string;
  type: 'NIPTransfer';
  attributes: {
    amount: number;          // in kobo
    currency: 'NGN';
    narration: string;
    destinationAccountNumber: string;
    destinationAccountName: string;
    destinationBankCode: string;
    reference: string;
    sessionId: string;       // NIBSS NIP session ID — critical for disputes
    status: 'PENDING' | 'PROCESSING' | 'SUCCESSFUL' | 'FAILED' | 'REVERSED';
    responseCode: string;
    responseMessage: string;
    createdAt: string;
    updatedAt: string;
  };
}

// ─── Shared ───────────────────────────────────────────────────────────────────

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
