import { config } from "dotenv";
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { z } from "zod";
import {
  ARC_CHAIN_ID,
  ARC_USDC_ADDRESS,
  MICROPAYMENT_COSTS,
  MerchantSchema,
} from "@errand/shared";
import { getGatewayClient } from "./gateway.js";
import { inspectQuotePaymentRequirement, isDemoMode } from "./payments.js";
import {
  createTask,
  getTask,
  getOrder,
  listMerchantOrders,
  listTasks,
  parseShoppingIntent,
  rankMerchantCandidates,
  redactOrder,
  recordOnchainOrderState,
  resetDemo,
  selectOption,
  updateOrder,
} from "./engine.js";
import { getEscrowConfig, verifyEscrowTransaction } from "./escrow.js";

config({ path: new URL("../../../.env.local", import.meta.url) });

const app = new Hono();
const allowedOrigins = [
  process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000",
  "http://127.0.0.1:3000",
];
app.use("*", cors({ origin: allowedOrigins }));

app.get("/health", (context) =>
  context.json({
    ok: true,
    service: "agent",
    chain: "arcTestnet",
    mode: isDemoMode() ? "local_demo" : "arc_testnet",
  }),
);

app.get("/wallet", async (context) => {
  const gateway = getGatewayClient();
  const balances = await gateway.getBalances();
  return context.json({
    address: gateway.address,
    mode: isDemoMode() ? "local_demo" : "arc_testnet",
    walletMicroUsdc: balances.wallet.balance.toString(),
    walletUsdc: balances.wallet.formatted,
    gatewayAvailableMicroUsdc: balances.gateway.available.toString(),
    gatewayAvailableUsdc: balances.gateway.formattedAvailable,
  });
});

app.get("/runtime", (context) =>
  context.json({
    mode: isDemoMode() ? "local_demo" : "arc_testnet",
    chainId: 5_042_002,
    quoteCostMicroUsdc: "500",
    taskCapMicroUsdc: "10000",
  }),
);

app.post("/research/preview", async (context) => {
  const input = z
    .object({ prompt: z.string().trim().min(8).max(500) })
    .parse(await context.req.json());
  const merchantApiUrl =
    process.env.MERCHANT_API_URL ?? "http://localhost:4000";
  const merchantResponse = await fetch(`${merchantApiUrl}/merchants`);
  if (!merchantResponse.ok)
    throw new Error("Merchant discovery service is unavailable");
  const discovered = MerchantSchema.array().parse(
    await merchantResponse.json(),
  );
  const requestedItems = parseShoppingIntent(input.prompt);
  const ranked = rankMerchantCandidates(discovered, requestedItems);
  const gateway = getGatewayClient();
  const balances = await gateway.getBalances();
  const queries = await Promise.all(
    ranked.merchants.map(async (merchant) => {
      const url = `${merchantApiUrl}/merchants/${merchant.id}/quote`;
      const requestBody = {
        taskId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        items: requestedItems,
      };
      const requirement = await inspectQuotePaymentRequirement({
        merchant,
        url,
        requestBody,
      });
      const decision = ranked.decisions.find(
        (candidate) => candidate.merchantId === merchant.id,
      );
      return {
        merchantId: merchant.id,
        merchantName: merchant.name,
        payTo: merchant.walletAddress,
        url,
        method: "POST",
        amountMicroUsdc: MICROPAYMENT_COSTS.quote.toString(),
        payload: { taskId: "generated-at-execution", items: requestedItems },
        gatewaySupported: true,
        advertisedRequirements: requirement,
        score: decision?.score ?? 0,
        reason: decision?.reason ?? "Selected by policy",
      };
    }),
  );
  const total = MICROPAYMENT_COSTS.quote * BigInt(queries.length);
  return context.json({
    mode: isDemoMode() ? "local_demo" : "arc_testnet",
    chainId: ARC_CHAIN_ID,
    network: `eip155:${ARC_CHAIN_ID}`,
    token: "USDC",
    tokenAddress: ARC_USDC_ADDRESS,
    payer: gateway.address,
    gatewayAvailableMicroUsdc: balances.gateway.available.toString(),
    totalMicroUsdc: total.toString(),
    withinTaskCap: total <= 10_000n,
    queries,
  });
});

app.post("/tasks", async (context) => {
  const input = z
    .object({ prompt: z.string().trim().min(8).max(500) })
    .parse(await context.req.json());
  return context.json(createTask(input.prompt), 201);
});

app.get("/tasks", (context) => context.json(listTasks()));

app.get("/tasks/:id", (context) => {
  const task = getTask(context.req.param("id"));
  return task
    ? context.json(task)
    : context.json({ error: "task_not_found" }, 404);
});

app.post("/tasks/:id/select", async (context) => {
  const input = z
    .object({ optionId: z.uuid() })
    .parse(await context.req.json());
  return context.json(selectOption(context.req.param("id"), input.optionId));
});

app.get("/escrow/config", (context) => context.json(getEscrowConfig()));

app.post("/orders/:id/sync", async (context) => {
  const input = z
    .object({ transactionHash: z.string().regex(/^0x[0-9a-fA-F]{64}$/) })
    .parse(await context.req.json());
  const order = getOrder(context.req.param("id"));
  if (!order) return context.json({ error: "order_not_found" }, 404);
  const verified = await verifyEscrowTransaction(
    order,
    input.transactionHash as `0x${string}`,
  );
  return context.json(redactOrder(recordOnchainOrderState(order.id, verified)));
});

app.get("/merchant/orders", (context) => context.json(listMerchantOrders()));

app.delete("/demo", (context) => {
  resetDemo();
  return context.json({ ok: true });
});

app.post("/merchant/orders/:id/status", async (context) => {
  const input = z
    .object({
      status: z.enum(["preparing", "ready", "completed"]),
      pickupCode: z
        .string()
        .regex(/^\d{6}$/)
        .optional(),
    })
    .parse(await context.req.json());
  return context.json(
    updateOrder(context.req.param("id"), input.status, input.pickupCode),
  );
});

app.onError((error, context) => {
  console.error("Agent API request failed", error);
  if (error instanceof z.ZodError)
    return context.json(
      { error: "invalid_request", issues: error.issues },
      400,
    );
  return context.json(
    { error: error instanceof Error ? error.message : "internal_error" },
    400,
  );
});

const port = Number(process.env.AGENT_PORT ?? 3_001);
serve({ fetch: app.fetch, port }, () => {
  console.log(`Agent API listening on http://localhost:${port}`);
});
