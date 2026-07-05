// ─── VTPass API Request / Response Types ─────────────────────────────────────
// VTPass is the VAS aggregator handling airtime and data purchases.
// Sandbox: https://sandbox.vtpass.com/api
// Production: https://api-service.vtpass.com/api

export enum NetworkOperator {
  MTN = 'mtn',
  GLO = 'glo',
  AIRTEL = 'airtel',
  ETISALAT = 'etisalat',
}

export enum DataNetworkOperator {
  MTN_DATA = 'mtn-data',
  GLO_DATA = 'glo-data',
  AIRTEL_DATA = 'airtel-data',
  ETISALAT_DATA = 'etisalat-data',
}

// ─── Airtime ──────────────────────────────────────────────────────────────────

export interface VTPassAirtimeRequest {
  request_id: string;       // unique reference per request
  serviceID: NetworkOperator;
  amount: number;           // in Naira
  phone: string;            // beneficiary phone number
  billersCode: string;      // same as phone for airtime
}

// ─── Data Bundles ─────────────────────────────────────────────────────────────

export interface VTPassDataBundle {
  variation_code: string;   // e.g. "mtn-10mb-100"
  name: string;             // e.g. "MTN 100MB - 3 Days"
  variation_amount: string; // price in Naira as string
  fixedPrice: 'Yes' | 'No';
}

export interface VTPassDataBundlesResponse {
  response_description: string;
  content: {
    varations: VTPassDataBundle[]; // Note: VTPass spells it "varations"
  };
}

// ─── Data Purchase ────────────────────────────────────────────────────────────

export interface VTPassDataRequest {
  request_id: string;
  serviceID: DataNetworkOperator;
  billersCode: string;      // beneficiary phone number
  variation_code: string;   // bundle code from /service-variations
  amount: number;           // in Naira
  phone: string;            // account phone for receipt
}

// ─── Shared Response ─────────────────────────────────────────────────────────

export type VTPassTransactionStatus =
  | 'delivered'
  | 'pending'
  | 'failed'
  | 'reversed';

export interface VTPassTransactionResponse {
  code: string;             // '000' = success, others = failure
  response_description: string;
  requestId: string;
  amount: string;
  transaction_date: {
    date: string;
    timezone: string;
  };
  purchased_code?: string;
  content: {
    transactions: {
      status: VTPassTransactionStatus;
      product_name: string;
      unique_element: string;  // phone number
      unit_price: number;
      quantity: number;
      service_verification: string | null;
      channel: string;
      commission: number;
      total_amount: number;
      discount: string | null;
      type: string;
      email: string;
      phone: string;
      name: string | null;
      convinience_fee: string;
      amount: string;
      platform: string;
      method: string;
      transactionId: string;
    };
  };
}
