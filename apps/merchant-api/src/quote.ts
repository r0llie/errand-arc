import { randomBytes, randomUUID } from "node:crypto";
import { privateKeyToAccount } from "viem/accounts";
import {
  ARC_CHAIN_ID,
  QuoteSchema,
  SkuRequestSchema,
  hashQuoteItems,
  quoteTypedData,
  recoverQuoteSigner,
  slugToBytes32,
  toMicroUsdcString,
  uuidToBytes32,
  type Quote,
} from "@errand/shared";
import { z } from "zod";
import type { MerchantRuntime } from "./catalog.js";

export const QuoteRequestSchema = z.object({
  taskId: z.uuid(),
  items: z.array(SkuRequestSchema).min(1).max(30),
});

export async function createSignedQuote(
  merchant: MerchantRuntime,
  input: z.infer<typeof QuoteRequestSchema>,
): Promise<Quote> {
  const items = input.items.map((request) => {
    const product = merchant.products.find(
      (candidate) => candidate.sku === request.sku,
    );
    const available = Boolean(
      product && product.stockMilli >= request.quantityMilli,
    );
    const unitPrice = product?.unitPriceMicroUsdc ?? 0n;
    const total = (unitPrice * BigInt(request.quantityMilli)) / 1_000n;

    return {
      sku: request.sku,
      name: product?.name ?? request.sku,
      quantityMilli: request.quantityMilli,
      unit: product?.unit ?? "",
      unitPriceMicroUsdc: toMicroUsdcString(unitPrice),
      totalPriceMicroUsdc: toMicroUsdcString(available ? total : 0n),
      available,
    };
  });

  const totalMicroUsdc = items.reduce(
    (sum, item) => sum + BigInt(item.totalPriceMicroUsdc),
    0n,
  );
  const id = randomUUID();
  const nonce = `0x${randomBytes(32).toString("hex")}` as const;
  const itemsHash = hashQuoteItems(items);
  const validUntil = Math.floor(Date.now() / 1_000) + 300;
  const account = privateKeyToAccount(merchant.privateKey);
  const message = {
    quoteId: uuidToBytes32(id),
    taskId: uuidToBytes32(input.taskId),
    merchantId: slugToBytes32(merchant.slug),
    merchantWallet: account.address,
    itemsHash,
    totalMicroUsdc,
    validUntil: BigInt(validUntil),
    nonce,
  };
  const signature = await account.signTypedData(
    quoteTypedData(ARC_CHAIN_ID, message),
  );
  const recoveredSigner = await recoverQuoteSigner(
    ARC_CHAIN_ID,
    message,
    signature,
  );

  return QuoteSchema.parse({
    id,
    taskId: input.taskId,
    merchantId: merchant.id,
    merchantName: merchant.name,
    merchantWallet: merchant.walletAddress,
    items,
    itemsHash,
    totalMicroUsdc: totalMicroUsdc.toString(),
    signature,
    validUntil,
    nonce,
    recoveredSigner,
  });
}
