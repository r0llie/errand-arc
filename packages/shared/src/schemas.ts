import { z } from "zod";
import { MicroUsdcStringSchema } from "./money.js";
import { SKU_KEYS } from "./skus.js";

export const AddressSchema = z.string().regex(/^0x[0-9a-fA-F]{40}$/);
export const HashSchema = z.string().regex(/^0x[0-9a-fA-F]{64}$/);
export const UuidSchema = z.uuid();
export const SkuSchema = z.enum(SKU_KEYS);

export const SkuRequestSchema = z.object({
  sku: SkuSchema,
  quantityMilli: z.number().int().positive(),
  notes: z.string().max(200).optional(),
});

export const MerchantCategorySchema = z.enum([
  "butcher",
  "greengrocer",
  "bakery",
  "market",
]);

export const MerchantSchema = z.object({
  id: UuidSchema,
  slug: z.string().regex(/^[a-z0-9-]+$/),
  name: z.string().min(1).max(120),
  category: MerchantCategorySchema,
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  walletAddress: AddressSchema,
  qualityScore: z.number().min(0).max(10),
  canNegotiate: z.boolean(),
  canReserve: z.boolean(),
  supportedSkus: z.array(SkuSchema),
  distanceMeters: z.number().nonnegative().optional(),
});

export const QuoteItemSchema = z.object({
  sku: SkuSchema,
  name: z.string(),
  quantityMilli: z.number().int().positive(),
  unit: z.string(),
  unitPriceMicroUsdc: MicroUsdcStringSchema,
  totalPriceMicroUsdc: MicroUsdcStringSchema,
  available: z.boolean(),
});

export const QuoteSchema = z.object({
  id: UuidSchema,
  taskId: UuidSchema,
  merchantId: UuidSchema,
  merchantName: z.string(),
  merchantWallet: AddressSchema,
  items: z.array(QuoteItemSchema).min(1),
  itemsHash: HashSchema,
  totalMicroUsdc: MicroUsdcStringSchema,
  signature: z.string().regex(/^0x[0-9a-fA-F]+$/),
  validUntil: z.number().int().positive(),
  nonce: HashSchema,
  recoveredSigner: AddressSchema,
});

export const TaskStatusSchema = z.enum([
  "parsing",
  "discovering",
  "quoting",
  "presenting",
  "awaiting_selection",
  "awaiting_approval",
  "funding_escrow",
  "monitoring",
  "completed",
  "refunded",
  "cancelled",
  "error",
]);

export type Merchant = z.infer<typeof MerchantSchema>;
export type Quote = z.infer<typeof QuoteSchema>;
export type QuoteItem = z.infer<typeof QuoteItemSchema>;
export type SkuRequest = z.infer<typeof SkuRequestSchema>;
export type TaskStatus = z.infer<typeof TaskStatusSchema>;
