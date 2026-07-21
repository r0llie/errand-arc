# Errand — Shared Package

> Monetary values are `bigint` inside trusted TypeScript code and decimal strings
> at JSON/API boundaries. See `08-ARC-AGENTIC-IMPLEMENTATION.md`.

## packages/shared/

Everything shared between web, agent, and scripts. Zero runtime dependencies except `zod` and `viem`.

---

## File Structure

```
packages/shared/src/
├── skus.ts           # Canonical SKU registry
├── schemas.ts        # All Zod schemas
├── eip712.ts         # EIP-712 types + signing helpers
├── usdc.ts           # USDC micro-USDC conversion utils
├── distance.ts       # Haversine distance calculation
└── index.ts          # Re-exports everything
```

---

## skus.ts

```typescript
export const SKU_REGISTRY = {
  // Kasap
  BEEF_GROUND: { name: "Kıyma", unit: "kg", category: "kasap" },
  BEEF_STEAK: { name: "Biftek", unit: "kg", category: "kasap" },
  LAMB_CHOP: { name: "Pirzola", unit: "kg", category: "kasap" },
  CHICKEN_WHOLE: { name: "Tavuk Bütün", unit: "adet", category: "kasap" },
  CHICKEN_BREAST: { name: "Tavuk Göğsü", unit: "kg", category: "kasap" },

  // Manav
  ONION: { name: "Soğan", unit: "kg", category: "manav" },
  TOMATO: { name: "Domates", unit: "kg", category: "manav" },
  PEPPER_GREEN: { name: "Yeşil Biber", unit: "kg", category: "manav" },
  PEPPER_RED: { name: "Kırmızı Biber", unit: "kg", category: "manav" },
  GARLIC: { name: "Sarımsak", unit: "kg", category: "manav" },
  PARSLEY: { name: "Maydanoz", unit: "demet", category: "manav" },
  POTATO: { name: "Patates", unit: "kg", category: "manav" },
  EGGPLANT: { name: "Patlıcan", unit: "kg", category: "manav" },
  LEMON: { name: "Limon", unit: "kg", category: "manav" },

  // Fırın
  BREAD_WHITE: { name: "Ekmek", unit: "adet", category: "fırın" },
  BREAD_WHOLE: { name: "Tam Buğday Ekmek", unit: "adet", category: "fırın" },
  PIDE: { name: "Pide", unit: "adet", category: "fırın" },
  SIMIT: { name: "Simit", unit: "adet", category: "fırın" },
  FLATBREAD: { name: "Lavaş", unit: "adet", category: "fırın" },

  // Market (kuru gıda)
  OIL_SUNFLOWER: { name: "Ayçiçek Yağı", unit: "litre", category: "market" },
  OIL_OLIVE: { name: "Zeytinyağı", unit: "litre", category: "market" },
  SALT: { name: "Tuz", unit: "kg", category: "market" },
  PEPPER_BLACK: { name: "Karabiber", unit: "gr", category: "market" },
  CUMIN: { name: "Kimyon", unit: "gr", category: "market" },
  PAPRIKA: { name: "Kırmızı Toz Biber", unit: "gr", category: "market" },
  RICE: { name: "Pirinç", unit: "kg", category: "market" },
  PASTA: { name: "Makarna", unit: "kg", category: "market" },
  TOMATO_PASTE: { name: "Domates Salçası", unit: "gr", category: "market" },
  CHARCOAL: { name: "Mangal Kömürü", unit: "kg", category: "market" },
} as const;

export type SKU = keyof typeof SKU_REGISTRY;
```

---

## schemas.ts

```typescript
import { z } from "zod";

// Core types
export const MicroUSDCString = z.string().regex(/^\d+$/);

export const SKUItemSchema = z.object({
  sku: z.string(),
  qty: z.number().positive(),
  unit: z.string(),
  notes: z.string().optional(),
});

export const MerchantSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  category: z.enum(["kasap", "manav", "fırın", "market"]),
  lat: z.number(),
  lng: z.number(),
  walletAddress: z.string(),
  qualityScore: z.number().min(0).max(10),
  canNegotiate: z.boolean(),
  canReserve: z.boolean(),
  distanceMeters: z.number().optional(),
});

export const QuoteItemSchema = z.object({
  sku: z.string(),
  name: z.string(),
  qty: z.number(),
  unit: z.string(),
  unitPriceMicroUsdc: MicroUSDCString,
  totalPriceMicroUsdc: MicroUSDCString,
  available: z.boolean(),
});

export const QuoteSchema = z.object({
  id: z.string().uuid(),
  merchantId: z.string().uuid(),
  merchantName: z.string(),
  items: z.array(QuoteItemSchema),
  totalMicroUsdc: MicroUSDCString,
  signature: z.string(),
  validUntil: z.number(), // unix timestamp
  nonce: z.string(),
});

export const ShoppingOptionSchema = z.object({
  type: z.enum(["cheapest", "best_quality", "pickup_route"]),
  label: z.string(),
  description: z.string(),
  merchants: z.array(
    z.object({
      merchant: MerchantSchema,
      quote: QuoteSchema,
      items: z.array(QuoteItemSchema),
    }),
  ),
  totalMicroUsdc: MicroUSDCString,
  estimatedPickupMinutes: z.number(),
});

export const TaskStatusSchema = z.enum([
  "idle",
  "parsing",
  "discovering",
  "quoting",
  "negotiating",
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

export const OrderStatusSchema = z.enum([
  "quoted",
  "reserved",
  "paid",
  "preparing",
  "ready",
  "completed",
  "refunded",
  "cancelled",
]);

// SSE Event types
export const AgentEventSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("status"),
    status: TaskStatusSchema,
    message: z.string(),
  }),
  z.object({ type: z.literal("skus_parsed"), skus: z.array(SKUItemSchema) }),
  z.object({
    type: z.literal("merchant_discovered"),
    merchant: MerchantSchema,
  }),
  z.object({ type: z.literal("quote_received"), quote: QuoteSchema }),
  z.object({
    type: z.literal("micropayment"),
    merchantId: z.string().uuid(),
    endpoint: z.string(),
    amountMicroUsdc: MicroUSDCString,
    paymentId: z.string(),
  }),
  z.object({
    type: z.literal("options_ready"),
    options: z.array(ShoppingOptionSchema),
  }),
  z.object({
    type: z.literal("funding_required"),
    chainId: z.literal(5042002),
    calls: z.array(
      z.object({
        to: z.string(),
        data: z.string(),
        value: z.string(),
      }),
    ),
  }),
  z.object({
    type: z.literal("escrow_funded"),
    orderId: z.string().uuid(),
    merchantId: z.string().uuid(),
    txHash: z.string(),
    amountMicroUsdc: MicroUSDCString,
  }),
  z.object({
    type: z.literal("order_status"),
    orderId: z.string(),
    status: OrderStatusSchema,
  }),
  z.object({ type: z.literal("error"), message: z.string() }),
]);

export type AgentEvent = z.infer<typeof AgentEventSchema>;
export type TaskStatus = z.infer<typeof TaskStatusSchema>;
export type OrderStatus = z.infer<typeof OrderStatusSchema>;
export type Merchant = z.infer<typeof MerchantSchema>;
export type Quote = z.infer<typeof QuoteSchema>;
export type ShoppingOption = z.infer<typeof ShoppingOptionSchema>;
export type SKUItem = z.infer<typeof SKUItemSchema>;
```

---

## eip712.ts

```typescript
import { createWalletClient, http, type WalletClient } from "viem";

export const QUOTE_DOMAIN = {
  name: "Errand",
  version: "1",
  // chainId: set from env
} as const;

export const QUOTE_TYPES = {
  Quote: [
    { name: "quoteId", type: "bytes32" },
    { name: "taskId", type: "bytes32" },
    { name: "merchantId", type: "bytes32" },
    { name: "merchantWallet", type: "address" },
    { name: "itemsHash", type: "bytes32" },
    { name: "totalMicroUsdc", type: "uint256" },
    { name: "validUntil", type: "uint256" },
    { name: "nonce", type: "bytes32" },
  ],
} as const;

export async function signQuote(
  walletClient: WalletClient,
  params: {
    quoteId: `0x${string}`;
    taskId: `0x${string}`;
    merchantId: `0x${string}`;
    merchantWallet: `0x${string}`;
    itemsHash: `0x${string}`;
    totalMicroUsdc: bigint;
    validUntil: bigint;
    nonce: `0x${string}`;
    chainId: number;
  },
): Promise<`0x${string}`> {
  return walletClient.signTypedData({
    domain: { ...QUOTE_DOMAIN, chainId: params.chainId },
    types: QUOTE_TYPES,
    primaryType: "Quote",
    message: {
      quoteId: params.quoteId,
      taskId: params.taskId,
      merchantId: params.merchantId,
      merchantWallet: params.merchantWallet,
      itemsHash: params.itemsHash,
      totalMicroUsdc: params.totalMicroUsdc,
      validUntil: params.validUntil,
      nonce: params.nonce,
    },
  });
}

export function isQuoteExpired(validUntil: number): boolean {
  return Date.now() / 1000 > validUntil;
}

export function generateNonce(): `0x${string}` {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return `0x${Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")}`;
}
```

---

## usdc.ts

```typescript
import { formatUnits, parseUnits } from "viem";

// 1 USDC = 1_000_000 micro-USDC
export const MICRO_USDC_DECIMALS = 6;
export const MICRO_USDC_PER_USDC = 1_000_000n;

export function parseUsdc(value: string): bigint {
  return parseUnits(value, MICRO_USDC_DECIMALS);
}

export function formatUsdc(micro: bigint): string {
  return `${formatUnits(micro, MICRO_USDC_DECIMALS)} USDC`;
}

// Micropayment costs
export const MICROPAYMENT_COSTS = {
  inventory: parseUsdc("0.0003"),
  quote: parseUsdc("0.0005"),
  negotiate: parseUsdc("0.002"),
  reserve: parseUsdc("0.001"),
} as const;

export const RESEARCH_BUDGET = {
  total: parseUsdc("0.01"),
  perRequest: parseUsdc("0.002"),
} as const;
```

---

## distance.ts

```typescript
// Haversine formula
export function haversineMeters(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): number {
  const R = 6371000; // Earth radius in meters
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

export function walkingMinutes(meters: number): number {
  return Math.ceil(meters / 80); // 80m per minute average
}
```
