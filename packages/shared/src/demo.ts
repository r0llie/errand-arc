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
  createdAt: string;
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

export type DemoOrderStatus = "funded" | "preparing" | "ready" | "completed";

export type DemoOrder = {
  id: string;
  taskId: string;
  merchantId: string;
  merchantName: string;
  merchantWallet: string;
  items: QuoteItem[];
  totalMicroUsdc: string;
  status: DemoOrderStatus;
  pickupCode: string;
  escrowReference: string;
  paymentMode: "simulated" | "arc_testnet";
  createdAt: string;
  updatedAt: string;
};

export type DemoTask = {
  id: string;
  prompt: string;
  status: TaskStatus;
  mode: "local_demo" | "arc_testnet";
  requestedItems: SkuRequest[];
  events: DemoEvent[];
  payments: DemoPayment[];
  quotes: Quote[];
  options: ShoppingOption[];
  selectedOptionId?: string;
  orders: DemoOrder[];
  error?: string;
  createdAt: string;
  updatedAt: string;
};
