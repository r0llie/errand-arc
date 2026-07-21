# Errand — Agent Bridge

> `08-ARC-AGENTIC-IMPLEMENTATION.md` is authoritative. Merchant payments use
> Circle's Gateway x402 SDK and standard payment headers.

## Overview

Hono server running on :3001. Houses the AI orchestration logic.
Uses Vercel AI SDK with Claude claude-sonnet-4-6 and tool calling.
Streams progress to frontend via SSE.

---

## File Structure

```
apps/agent/src/
├── index.ts              # Hono app, routes
├── orchestrator.ts       # State machine, task runner
├── tools/
│   ├── parseShopping.ts  # NL → SKU list
│   ├── discoverMerchants.ts
│   ├── queryMerchant.ts  # x402 payment + quote
│   ├── buildOptions.ts   # 3 shopping options
│   └── buildFundingPlan.ts # Unsigned approval + escrow calls for user wallet
├── payment/
│   ├── micropayment.ts   # x402 flow
│   └── budget.ts         # Budget enforcement
├── chain/
│   └── escrow.ts         # Contract interactions via viem
└── db/
    └── supabase.ts       # Task + order persistence
```

---

## index.ts (Hono Routes)

```typescript
import { Hono } from "hono";
import { cors } from "hono/cors";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import {
  startTask,
  getTask,
  selectOption,
  approvePayment,
  verifyFunding,
  cancelTask,
} from "./orchestrator";
import { streamSSE } from "hono/streaming";
import { replayTaskEvents, subscribeTaskEvents } from "./events";

const app = new Hono();
app.use("*", cors({ origin: process.env.NEXT_PUBLIC_APP_URL! }));

// Start a new shopping task
app.post(
  "/tasks",
  zValidator(
    "json",
    z.object({
      userWallet: z.string(),
      prompt: z.string().min(1).max(500),
      userLat: z.number(),
      userLng: z.number(),
    }),
  ),
  async (c) => {
    const body = c.req.valid("json");
    const task = await startTask(body);
    return c.json({ taskId: task.id });
  },
);

// SSE stream of agent events
app.get("/tasks/:id/stream", async (c) => {
  const taskId = c.req.param("id");
  const lastEventId = Number(c.req.header("Last-Event-ID") ?? 0);

  return streamSSE(c, async (stream) => {
    for (const event of await replayTaskEvents(taskId, lastEventId)) {
      await stream.writeSSE({
        id: String(event.sequence),
        data: JSON.stringify(event.payload),
      });
    }

    const unsubscribe = subscribeTaskEvents(taskId, async (event) => {
      await stream.writeSSE({
        id: String(event.sequence),
        data: JSON.stringify(event.payload),
      });
    });
    const heartbeat = setInterval(
      () => stream.writeSSE({ event: "ping", data: "{}" }),
      15_000,
    );

    stream.onAbort(() => {
      clearInterval(heartbeat);
      unsubscribe();
    });

    await waitForTaskCompletionOrDisconnect(taskId, c.req.raw.signal);
    clearInterval(heartbeat);
    unsubscribe();
  });
});

// Get current task state
app.get("/tasks/:id", async (c) => {
  const task = await getTask(c.req.param("id"));
  if (!task) return c.json({ error: "Not found" }, 404);
  return c.json(task);
});

// User selects an option
app.post(
  "/tasks/:id/select-option",
  zValidator(
    "json",
    z.object({
      optionType: z.enum(["cheapest", "best_quality", "pickup_route"]),
    }),
  ),
  async (c) => {
    const result = await selectOption(
      c.req.param("id"),
      c.req.valid("json").optionType,
    );
    return c.json(result);
  },
);

// User approves payment
app.post("/tasks/:id/approve", async (c) => {
  const result = await approvePayment(c.req.param("id"));
  return c.json(result);
});

// Verify receipts produced by the user's Privy wallet.
app.post(
  "/tasks/:id/funding-complete",
  zValidator(
    "json",
    z.object({
      txHashes: z.array(z.string().regex(/^0x[0-9a-fA-F]{64}$/)).min(1),
    }),
  ),
  async (c) => {
    const result = await verifyFunding(
      c.req.param("id"),
      c.req.valid("json").txHashes,
    );
    return c.json(result);
  },
);

// Cancel task
app.post("/tasks/:id/cancel", async (c) => {
  const result = await cancelTask(c.req.param("id"));
  return c.json(result);
});

export default { port: 3001, fetch: app.fetch };
```

---

## orchestrator.ts (State Machine)

```typescript
import { generateText } from "ai";
import { anthropic } from "@ai-sdk/anthropic";
import { parseShopping } from "./tools/parseShopping";
import { discoverMerchants } from "./tools/discoverMerchants";
import { queryMerchant } from "./tools/queryMerchant";
import { buildOptions } from "./tools/buildOptions";
import { buildFundingPlan } from "./tools/buildFundingPlan";
import { emit, waitFor } from "./events";
import { supabase } from "./db/supabase";

export async function startTask(input: {
  userWallet: string;
  prompt: string;
  userLat: number;
  userLng: number;
}) {
  // Create task in DB
  const { data: task } = await supabase
    .from("tasks")
    .insert({
      user_wallet: input.userWallet,
      prompt: input.prompt,
      status: "parsing",
    })
    .select()
    .single();

  // Run orchestration async
  runOrchestration(task.id, input).catch(console.error);

  return task;
}

async function runOrchestration(
  taskId: string,
  input: {
    prompt: string;
    userLat: number;
    userLng: number;
    userWallet: string;
  },
) {
  try {
    // Step 1: Parse shopping list
    emit(taskId, {
      type: "status",
      status: "parsing",
      message: "İstek analiz ediliyor...",
    });

    const skus = await parseShopping(input.prompt);
    emit(taskId, { type: "skus_parsed", skus });
    await updateTask(taskId, { status: "discovering", skus });

    // Step 2: Discover merchants
    emit(taskId, {
      type: "status",
      status: "discovering",
      message: "Yakın esnaf aranıyor...",
    });

    const merchants = await discoverMerchants(
      skus,
      input.userLat,
      input.userLng,
    );
    merchants.forEach((m) =>
      emit(taskId, { type: "merchant_discovered", merchant: m }),
    );
    await updateTask(taskId, { status: "quoting" });

    // Step 3: Query merchants (with micropayments)
    emit(taskId, {
      type: "status",
      status: "quoting",
      message: "Fiyat teklifleri toplanıyor...",
    });

    const quotes = [];
    for (const merchant of merchants) {
      try {
        const quote = await queryMerchant(taskId, merchant, skus);
        quotes.push({ merchant, quote });
        emit(taskId, { type: "quote_received", quote });
      } catch (err) {
        // Skip merchant if budget exceeded or unavailable
        console.warn(`Skipping merchant ${merchant.id}:`, err);
      }
    }

    // Step 4: Build options
    emit(taskId, {
      type: "status",
      status: "presenting",
      message: "Seçenekler hazırlanıyor...",
    });

    const options = await buildOptions(quotes, skus);
    emit(taskId, { type: "options_ready", options });
    await updateTask(taskId, { status: "awaiting_selection", options });

    // Step 5: Wait for user selection
    const selectedOption = await waitFor(taskId, "option_selected", 300_000); // 5min timeout

    // Step 6: Wait for user intent, then build unsigned Arc calls
    emit(taskId, {
      type: "status",
      status: "awaiting_approval",
      message: "Ödeme onayı bekleniyor...",
    });
    await waitFor(taskId, "payment_approved", 300_000);

    // Step 7: The browser wallet, not the agent server, funds escrow
    emit(taskId, {
      type: "status",
      status: "funding_escrow",
      message: "Escrow fonlanıyor...",
    });

    const fundingPlan = await buildFundingPlan(
      taskId,
      selectedOption,
      input.userWallet,
    );
    emit(taskId, {
      type: "funding_required",
      chainId: 5042002,
      calls: fundingPlan.calls,
    });

    // Frontend submits the calls with Privy and POSTs transaction hashes.
    // Backend verifies chain, sender, target, calldata, amount, and successful receipts.
    await waitFor(taskId, "funding_verified", 300_000);

    await updateTask(taskId, { status: "monitoring" });
  } catch (err) {
    emit(taskId, { type: "error", message: String(err) });
    await updateTask(taskId, { status: "error" });
  }
}
```

---

## tools/parseShopping.ts

```typescript
import { generateObject } from "ai";
import { anthropic } from "@ai-sdk/anthropic";
import { z } from "zod";
import { SKU_REGISTRY } from "@errand/shared";

export async function parseShopping(prompt: string) {
  const { object } = await generateObject({
    model: anthropic("claude-sonnet-4-6"),
    schema: z.object({
      items: z.array(
        z.object({
          sku: z.enum(Object.keys(SKU_REGISTRY) as [string, ...string[]]),
          qty: z.number().positive(),
          notes: z.string().optional(),
        }),
      ),
      servings: z.number().optional(),
      occasion: z.string().optional(),
    }),
    system: `You are a Turkish shopping assistant. Parse the user's request into a grocery list.
Map items to canonical SKUs from this registry: ${JSON.stringify(Object.keys(SKU_REGISTRY))}.
Never invent SKUs. If unsure, pick the closest match.
For "köfte" recipe needs: BEEF_GROUND, ONION, PARSLEY, BREAD_WHITE, PEPPER_BLACK, CUMIN, SALT`,
    prompt,
  });

  return object.items.map((item) => ({
    ...item,
    unit: SKU_REGISTRY[item.sku as keyof typeof SKU_REGISTRY].unit,
  }));
}
```

---

## tools/queryMerchant.ts (Gateway x402)

Use the SDK for the complete 402 negotiation. Budget reservation must be atomic
and happen before `pay()`.

```typescript
import { GatewayClient } from "@circle-fin/x402-batching/client";
import { MICROPAYMENT_COSTS } from "@errand/shared";
import { reserveBudget, settleBudget, failBudget } from "../payment/budget";

const gateway = new GatewayClient({
  chain: "arcTestnet",
  privateKey: process.env.AGENT_WALLET_PRIVATE_KEY as `0x${string}`,
});

export async function queryMerchant(
  taskId: string,
  merchant: Merchant,
  skus: SKUItem[],
) {
  const url = `http://localhost:4000/merchants/${merchant.id}/quote`;
  const support = await gateway.supports(url);
  if (!support.supported) throw new Error("Gateway x402 is not supported");

  const reservation = await reserveBudget({
    taskId,
    merchantId: merchant.id,
    endpoint: "quote",
    amount: MICROPAYMENT_COSTS.quote,
  });

  try {
    const result = await gateway.pay<Quote>(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ skus }),
    });

    await settleBudget(reservation.id, {
      amount: result.amount,
      paymentId: result.transaction,
    });
    return result.data;
  } catch (error) {
    await failBudget(reservation.id, String(error));
    throw error;
  }
}
```

---

## tools/buildOptions.ts

```typescript
export async function buildOptions(
  quotes: Array<{ merchant: Merchant; quote: Quote }>,
  requestedSkus: SKUItem[]
): Promise<ShoppingOption[]> {
  const options: ShoppingOption[] = []

  // Option 1: Cheapest — minimize total cost
  const cheapest = buildCheapestOption(quotes, requestedSkus)
  if (cheapest) options.push(cheapest)

  // Option 2: Best Quality — maximize quality score
  const bestQuality = buildBestQualityOption(quotes, requestedSkus)
  if (bestQuality) options.push(bestQuality)

  // Option 3: Pickup Route — minimize number of stops
  const pickupRoute = buildPickupRouteOption(quotes, requestedSkus)
  if (pickupRoute) options.push(pickupRoute)

  return options
}

function buildCheapestOption(quotes, requestedSkus): ShoppingOption {
  // For each SKU, find the merchant with lowest price
  // Group by merchant, build cart
  // ...
  return {
    type: 'cheapest',
    label: 'En Ucuz',
    description: 'Toplam maliyeti minimize eder',
    merchants: /* grouped merchants */,
    totalMicroUsdc: /* sum */,
    estimatedPickupMinutes: /* max walking time */,
  }
}
```

---

## Merchant Server (apps/merchant-api, :4000)

### Seed Data (5 merchants in Ankara/Kızılay)

```typescript
// scripts/seed.ts
export const MERCHANTS = [
  {
    slug: "merchant-ali-kasap", // database id is a separate UUID
    name: "Ali Kasap",
    category: "kasap",
    lat: 39.9208,
    lng: 32.8541,
    walletAddress: "0x...", // generate test wallets
    qualityScore: 9.1,
    canNegotiate: true,
    canReserve: false,
    products: [
      {
        sku: "BEEF_GROUND",
        name: "Dana Kıyma",
        priceMicroUsdc: 1800000,
        stock: 50,
        unit: "kg",
      },
      {
        sku: "BEEF_STEAK",
        name: "Dana Biftek",
        priceMicroUsdc: 3500000,
        stock: 20,
        unit: "kg",
      },
      {
        sku: "LAMB_CHOP",
        name: "Kuzu Pirzola",
        priceMicroUsdc: 4200000,
        stock: 15,
        unit: "kg",
      },
    ],
  },
  {
    slug: "merchant-can-kasap",
    name: "Can Kasap",
    category: "kasap",
    lat: 39.9195,
    lng: 32.856,
    walletAddress: "0x...",
    qualityScore: 7.2,
    canNegotiate: true,
    canReserve: false,
    products: [
      {
        sku: "BEEF_GROUND",
        name: "Kıyma",
        priceMicroUsdc: 1500000,
        stock: 80,
        unit: "kg",
      },
      {
        sku: "CHICKEN_WHOLE",
        name: "Bütün Tavuk",
        priceMicroUsdc: 1200000,
        stock: 30,
        unit: "adet",
      },
    ],
  },
  {
    slug: "merchant-zeynep-manav",
    name: "Zeynep Manav",
    category: "manav",
    lat: 39.9215,
    lng: 32.8555,
    walletAddress: "0x...",
    qualityScore: 8.4,
    canNegotiate: true,
    canReserve: false,
    products: [
      {
        sku: "ONION",
        name: "Kuru Soğan",
        priceMicroUsdc: 300000,
        stock: 200,
        unit: "kg",
      },
      {
        sku: "TOMATO",
        name: "Domates",
        priceMicroUsdc: 450000,
        stock: 150,
        unit: "kg",
      },
      {
        sku: "PARSLEY",
        name: "Maydanoz",
        priceMicroUsdc: 100000,
        stock: 50,
        unit: "demet",
      },
      {
        sku: "PEPPER_GREEN",
        name: "Yeşil Biber",
        priceMicroUsdc: 350000,
        stock: 100,
        unit: "kg",
      },
    ],
  },
  {
    slug: "merchant-cem-firin",
    name: "Cem Fırın",
    category: "fırın",
    lat: 39.922,
    lng: 32.8548,
    walletAddress: "0x...",
    qualityScore: 8.8,
    canNegotiate: false,
    canReserve: true,
    products: [
      {
        sku: "BREAD_WHITE",
        name: "Ekmek",
        priceMicroUsdc: 150000,
        stock: 100,
        unit: "adet",
      },
      {
        sku: "PIDE",
        name: "Pide",
        priceMicroUsdc: 250000,
        stock: 30,
        unit: "adet",
      },
      {
        sku: "SIMIT",
        name: "Simit",
        priceMicroUsdc: 100000,
        stock: 50,
        unit: "adet",
      },
    ],
  },
  {
    slug: "merchant-mini-market",
    name: "Mini Market",
    category: "market",
    lat: 39.92,
    lng: 32.857,
    walletAddress: "0x...",
    qualityScore: 6.9,
    canNegotiate: false,
    canReserve: false,
    products: [
      {
        sku: "OIL_SUNFLOWER",
        name: "Ayçiçek Yağı",
        priceMicroUsdc: 1200000,
        stock: 20,
        unit: "litre",
      },
      {
        sku: "SALT",
        name: "Tuz",
        priceMicroUsdc: 200000,
        stock: 100,
        unit: "kg",
      },
      {
        sku: "PEPPER_BLACK",
        name: "Karabiber",
        priceMicroUsdc: 150000,
        stock: 50,
        unit: "gr",
      },
      {
        sku: "CUMIN",
        name: "Kimyon",
        priceMicroUsdc: 180000,
        stock: 40,
        unit: "gr",
      },
      {
        sku: "TOMATO_PASTE",
        name: "Domates Salçası",
        priceMicroUsdc: 400000,
        stock: 30,
        unit: "gr",
      },
    ],
  },
];
```

### Merchant API Endpoints

Each merchant exposes these endpoints (single Express server, routed by merchantId):

```
POST /merchants/:id/inventory   — list available SKUs (costs 0.0003 USDC)
POST /merchants/:id/quote       — get priced quote (costs 0.0005 USDC)
POST /merchants/:id/negotiate   — request discount (costs 0.002 USDC)
POST /merchants/:id/reserve     — hold stock (costs 0.001 USDC)
GET  /merchants/:id/orders      — merchant sees their orders (FREE)
POST /merchants/:id/orders/:orderId/preparing — mark preparing (FREE)
POST /merchants/:id/orders/:orderId/ready     — mark ready (FREE)
POST /merchants/:id/orders/:orderId/verify    — verify delivery code (FREE)
```

Every paid endpoint follows x402 pattern:

1. No payment header → 402 + payment details
2. Valid payment header → 200 + data
