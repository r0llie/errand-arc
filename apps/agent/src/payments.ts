import {
  ARC_CHAIN_ID,
  ARC_USDC_ADDRESS,
  MICROPAYMENT_COSTS,
  QuoteSchema,
  RESEARCH_POLICY,
  hashQuoteItems,
  recoverQuoteSigner,
  slugToBytes32,
  uuidToBytes32,
  type DemoPayment,
  type Merchant,
  type Quote,
  type SkuRequest,
} from "@errand/shared";
import { z } from "zod";
import { getGatewayClient } from "./gateway.js";

type BuyQuoteInput = {
  merchant: Merchant;
  merchantApiUrl: string;
  taskId: string;
  items: SkuRequest[];
};

type QuotePurchase = { quote: Quote; payment: DemoPayment };

const PaymentRequiredSchema = z.object({
  x402Version: z.number().int().positive(),
  accepts: z.array(
    z.object({
      scheme: z.literal("exact"),
      network: z.literal("eip155:5042002"),
      asset: z.string(),
      amount: z.string().regex(/^\d+$/),
      payTo: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
    }),
  ),
});

type BudgetReservation = {
  id: string;
  idempotencyKey: string;
  amount: bigint;
  state: "pending" | "settled" | "failed";
};

export class ResearchBudget {
  readonly #reservations = new Map<string, BudgetReservation>();

  reserve(idempotencyKey: string, amount: bigint): BudgetReservation {
    const existing = this.#reservations.get(idempotencyKey);
    if (existing) return existing;
    if (amount <= 0n || amount > RESEARCH_POLICY.requestCap) {
      throw new Error("Research payment exceeds the per-request policy");
    }
    if (this.committed + amount > RESEARCH_POLICY.taskCap) {
      throw new Error("Research payment would exceed the 0.01 USDC task cap");
    }
    const reservation: BudgetReservation = {
      id: crypto.randomUUID(),
      idempotencyKey,
      amount,
      state: "pending",
    };
    this.#reservations.set(idempotencyKey, reservation);
    return reservation;
  }

  settle(idempotencyKey: string): void {
    const reservation = this.#reservations.get(idempotencyKey);
    if (!reservation) throw new Error("Research reservation not found");
    reservation.state = "settled";
  }

  fail(idempotencyKey: string): void {
    const reservation = this.#reservations.get(idempotencyKey);
    if (!reservation) return;
    reservation.state = "failed";
  }

  get committed(): bigint {
    return [...this.#reservations.values()].reduce(
      (total, reservation) =>
        reservation.state === "failed" ? total : total + reservation.amount,
      0n,
    );
  }

  get remaining(): bigint {
    return RESEARCH_POLICY.taskCap - this.committed;
  }
}

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

export async function inspectQuotePaymentRequirement({
  merchant,
  url,
  requestBody,
}: {
  merchant: Merchant;
  url: string;
  requestBody: { taskId: string; items: SkuRequest[] };
}) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(requestBody),
  });
  if (response.status !== 402) {
    throw new Error(`${merchant.name} did not return HTTP 402 before payment`);
  }
  const encoded = response.headers.get("payment-required");
  if (!encoded) throw new Error(`${merchant.name} omitted PAYMENT-REQUIRED`);
  let decoded: unknown;
  try {
    decoded = JSON.parse(Buffer.from(encoded, "base64").toString("utf8"));
  } catch {
    throw new Error(`${merchant.name} returned invalid PAYMENT-REQUIRED data`);
  }
  const paymentRequired = PaymentRequiredSchema.parse(decoded);
  const requirement = paymentRequired.accepts.find(
    (candidate) => candidate.network === `eip155:${ARC_CHAIN_ID}`,
  );
  if (!requirement)
    throw new Error(`${merchant.name} does not accept Arc Gateway`);
  if (requirement.asset.toLowerCase() !== ARC_USDC_ADDRESS.toLowerCase()) {
    throw new Error(`${merchant.name} advertised an unexpected payment token`);
  }
  if (BigInt(requirement.amount) !== MICROPAYMENT_COSTS.quote) {
    throw new Error(`${merchant.name} advertised an unexpected quote price`);
  }
  if (
    requirement.payTo.toLowerCase() !== merchant.walletAddress.toLowerCase()
  ) {
    throw new Error(`${merchant.name} advertised an unexpected payee`);
  }
  return requirement;
}

export function quotePaymentRequest(requestBody: {
  taskId: string;
  items: SkuRequest[];
}) {
  // GatewayClient already supplies Content-Type. Passing another casing of the
  // same header makes undici combine the values and Express skips JSON parsing.
  return { method: "POST" as const, body: requestBody };
}

export async function buySignedQuote({
  merchant,
  merchantApiUrl,
  taskId,
  items,
  budget,
  payerAddress,
}: BuyQuoteInput & {
  budget: ResearchBudget;
  payerAddress: string;
}): Promise<QuotePurchase> {
  const requestBody = { taskId, items };
  const endpoint = `/merchants/${merchant.id}/quote`;
  const idempotencyKey = `${taskId}:${merchant.id}:quote`;
  budget.reserve(idempotencyKey, MICROPAYMENT_COSTS.quote);
  if (isDemoMode()) {
    try {
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
      const quote = await verifyPurchasedQuote(result.quote, merchant, taskId);
      budget.settle(idempotencyKey);
      return {
        quote,
        payment: {
          ...result.payment,
          payer: payerAddress,
          payee: merchant.walletAddress,
          endpoint,
          idempotencyKey,
        },
      };
    } catch (error) {
      budget.fail(idempotencyKey);
      throw error;
    }
  }

  const gateway = getGatewayClient();
  const url = `${merchantApiUrl}/merchants/${merchant.id}/quote`;
  try {
    await inspectQuotePaymentRequirement({ merchant, url, requestBody });
    const result = await gateway.pay<Quote>(
      url,
      quotePaymentRequest(requestBody),
    );
    if (result.amount !== MICROPAYMENT_COSTS.quote) {
      throw new Error(`Unexpected quote price from ${merchant.name}`);
    }
    const quote = await verifyPurchasedQuote(result.data, merchant, taskId);
    budget.settle(idempotencyKey);
    return {
      quote,
      payment: {
        id: randomPaymentId(result.transaction),
        merchantId: merchant.id,
        merchantName: merchant.name,
        amountMicroUsdc: result.amount.toString(),
        network: "eip155:5042002",
        status: "settled",
        mode: "gateway",
        transaction: result.transaction,
        payer: payerAddress,
        payee: merchant.walletAddress,
        endpoint,
        idempotencyKey,
        createdAt: new Date().toISOString(),
      },
    };
  } catch (error) {
    budget.fail(idempotencyKey);
    throw error;
  }
}

export async function verifyPurchasedQuote(
  candidate: unknown,
  merchant: Merchant,
  taskId: string,
): Promise<Quote> {
  const quote = QuoteSchema.parse(candidate);
  if (quote.taskId !== taskId || quote.merchantId !== merchant.id) {
    throw new Error("Quote identity does not match the request");
  }
  if (
    quote.merchantWallet.toLowerCase() !== merchant.walletAddress.toLowerCase()
  ) {
    throw new Error("Quote payee does not match the discovered merchant");
  }
  if (quote.validUntil <= Math.floor(Date.now() / 1_000)) {
    throw new Error("Merchant quote has expired");
  }
  const itemsHash = hashQuoteItems(quote.items);
  if (itemsHash.toLowerCase() !== quote.itemsHash.toLowerCase()) {
    throw new Error("Merchant quote item hash is invalid");
  }
  const total = quote.items.reduce(
    (sum, item) => sum + BigInt(item.totalPriceMicroUsdc),
    0n,
  );
  if (total !== BigInt(quote.totalMicroUsdc)) {
    throw new Error("Merchant quote total is invalid");
  }
  const recovered = await recoverQuoteSigner(
    ARC_CHAIN_ID,
    {
      quoteId: uuidToBytes32(quote.id),
      taskId: uuidToBytes32(taskId),
      merchantId: slugToBytes32(merchant.slug),
      merchantWallet: merchant.walletAddress as `0x${string}`,
      itemsHash,
      totalMicroUsdc: total,
      validUntil: BigInt(quote.validUntil),
      nonce: quote.nonce as `0x${string}`,
    },
    quote.signature as `0x${string}`,
  );
  if (recovered.toLowerCase() !== merchant.walletAddress.toLowerCase()) {
    throw new Error("Merchant quote signature is invalid");
  }
  return { ...quote, recoveredSigner: recovered };
}

function randomPaymentId(transaction: string) {
  return transaction || crypto.randomUUID();
}
