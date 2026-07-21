import { config } from "dotenv";
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { z } from "zod";
import { getGatewayClient } from "./gateway.js";
import {
  createTask,
  getTask,
  listOrders,
  listTasks,
  resetDemo,
  selectOption,
  updateOrder,
} from "./engine.js";

config({ path: new URL("../../../.env.local", import.meta.url) });

const app = new Hono();
app.use(
  "*",
  cors({ origin: process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000" }),
);

app.get("/health", (context) =>
  context.json({ ok: true, service: "agent", chain: "arcTestnet" }),
);

app.get("/wallet", async (context) => {
  const gateway = getGatewayClient();
  const balances = await gateway.getBalances();
  return context.json({
    address: gateway.address,
    walletMicroUsdc: balances.wallet.balance.toString(),
    gatewayAvailableMicroUsdc: balances.gateway.available.toString(),
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

app.get("/merchant/orders", (context) => context.json(listOrders()));

app.delete("/demo", (context) => {
  resetDemo();
  return context.json({ ok: true });
});

app.post("/merchant/orders/:id/status", async (context) => {
  const input = z
    .object({ status: z.enum(["preparing", "ready", "completed"]) })
    .parse(await context.req.json());
  return context.json(updateOrder(context.req.param("id"), input.status));
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
