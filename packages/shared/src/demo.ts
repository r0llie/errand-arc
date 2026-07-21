import type { Quote, QuoteItem, SkuRequest, TaskStatus } from "./schemas.js";

export type DemoEvent = {
  id: string;
  type: "intent" | "discovery" | "payment" | "quote" | "decision" | "order";
  title: string;
  detail: string;
  createdAt: string;
};

export type DemoPayment = {
  id: string;
  merchantId: string;
  merchantName: string;
  amountMicroUsdc: string;
  network: "eip155:5042002";
  status: "settled";
  mode: "simulated" | "gateway";
  transaction?: string;
  payer: string;
  payee: string;
  endpoint: string;
  idempotencyKey: string;
  createdAt: string;
};

export type MerchantPaymentReceipt = {
  id: string;
  merchantId: string;
  merchantName: string;
  payer: string;
  payee: string;
  amountMicroUsdc: string;
  network: "eip155:5042002";
  endpoint: string;
  mode: "simulated" | "gateway";
  transaction?: string;
  createdAt: string;
};

export type MerchantDecision = {
  merchantId: string;
  merchantName: string;
  score: number;
  coverage: number;
  distanceMeters: number;
  selected: boolean;
  reason: string;
};

export type MerchantBasket = {
  merchantId: string;
  merchantName: string;
  merchantWallet: string;
  quoteId: string;
  items: QuoteItem[];
  subtotalMicroUsdc: string;
};

export type ShoppingOption = {
  id: string;
  strategy: "lowest_cost" | "best_quality" | "fewest_stops";
  title: string;
  description: string;
  merchantBaskets: MerchantBasket[];
  totalMicroUsdc: string;
  itemCount: number;
};

export type DemoOrderStatus =
  | "awaiting_funding"
  | "funded"
  | "preparing"
  | "ready"
  | "completed"
  | "refunded"
  | "disputed";

export type DemoOrder = {
  id: string;
  taskId: string;
  merchantId: string;
  merchantName: string;
  merchantWallet: string;
  items: QuoteItem[];
  totalMicroUsdc: string;
  status: DemoOrderStatus;
  pickupCode?: string;
  deliveryCodeSalt?: string;
  pickupDeadline: number;
  escrowReference: string;
  escrowContract?: string;
  buyerWallet?: string;
  fundTransaction?: string;
  releaseTransaction?: string;
  lastTransaction?: string;
  paymentMode: "simulated" | "arc_testnet";
  createdAt: string;
  updatedAt: string;
};

export type MerchantOrder = Omit<DemoOrder, "pickupCode" | "deliveryCodeSalt">;

export type DemoTask = {
  id: string;
  prompt: string;
  status: TaskStatus;
  mode: "local_demo" | "arc_testnet";
  requestedItems: SkuRequest[];
  events: DemoEvent[];
  payments: DemoPayment[];
  merchantDecisions: MerchantDecision[];
  remainingResearchBudgetMicroUsdc: string;
  quotes: Quote[];
  options: ShoppingOption[];
  selectedOptionId?: string;
  orders: DemoOrder[];
  error?: string;
  createdAt: string;
  updatedAt: string;
};
