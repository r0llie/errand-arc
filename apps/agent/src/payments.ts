import {
  MICROPAYMENT_COSTS,
  QuoteSchema,
  RESEARCH_POLICY,
  type DemoPayment,
  type Merchant,
  type Quote,
  type SkuRequest,
} from "@errand/shared";
import { getGatewayClient } from "./gateway.js";

type BuyQuoteInput = {
  merchant: Merchant;
  merchantApiUrl: string;
  taskId: string;
  items: SkuRequest[];
};

type QuotePurchase = { quote: Quote; payment: DemoPayment };

export function isDemoMode() {
  return process.env.DEMO_MODE !== "false";
}

export async function assertResearchBalance(merchantCount: number) {
  const required = MICROPAYMENT_COSTS.quote * BigInt(merchantCount);
  if (required > RESEARCH_POLICY.taskCap) {
    throw new Error("Merchant research would exceed the 0.01 USDC task cap");
  }
  if (isDemoMode()) return;

  const balances = await getGatewayClient().getBalances();
  if (balances.gateway.available < required) {
    throw new Error(
      `Gateway balance is too low. Required ${required} micro-USDC, available ${balances.gateway.available} micro-USDC.`,
    );
  }
}

export async function buySignedQuote({
  merchant,
  merchantApiUrl,
  taskId,
  items,
}: BuyQuoteInput): Promise<QuotePurchase> {
  const requestBody = { taskId, items };
  if (isDemoMode()) {
    const response = await fetch(
      `${merchantApiUrl}/demo/merchants/${merchant.id}/quote`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(requestBody),
      },
    );
    if (!response.ok)
      throw new Error(`Quote request failed for ${merchant.name}`);
    const result = (await response.json()) as QuotePurchase;
    return { quote: QuoteSchema.parse(result.quote), payment: result.payment };
  }

  const gateway = getGatewayClient();
  const url = `${merchantApiUrl}/merchants/${merchant.id}/quote`;
  const support = await gateway.supports(url);
  if (!support.supported) {
    throw new Error(`${merchant.name} does not advertise Gateway x402 support`);
  }

  const result = await gateway.pay<Quote>(url, {
    method: "POST",
    body: requestBody,
    headers: { "content-type": "application/json" },
  });

  return {
    quote: QuoteSchema.parse(result.data),
    payment: {
      id: randomPaymentId(result.transaction),
      merchantId: merchant.id,
      merchantName: merchant.name,
      amountMicroUsdc: result.amount.toString(),
      network: "eip155:5042002",
      status: "settled",
      mode: "gateway",
      transaction: result.transaction,
      createdAt: new Date().toISOString(),
    },
  };
}

function randomPaymentId(transaction: string) {
  return transaction || crypto.randomUUID();
}
