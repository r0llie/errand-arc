import { randomBytes, randomUUID } from "node:crypto";
import {
  type DemoEvent,
  type DemoOrder,
  type DemoOrderStatus,
  type DemoTask,
  type Merchant,
  type MerchantBasket,
  type Quote,
  type QuoteItem,
  type ShoppingOption,
  type Sku,
  type SkuRequest,
} from "@errand/shared";
import {
  assertResearchBalance,
  buySignedQuote,
  isDemoMode,
} from "./payments.js";

const tasks = new Map<string, DemoTask>();
const wait = (milliseconds: number) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

const scaled = (baseMilli: number, people: number) =>
  Math.max(1, Math.round((baseMilli * people) / 4));

export function parseShoppingIntent(prompt: string): SkuRequest[] {
  const people = Math.min(
    20,
    Math.max(1, Number(prompt.match(/\b(\d{1,2})\b/)?.[1] ?? 4)),
  );
  const normalized = prompt.toLowerCase();

  if (normalized.includes("breakfast") || normalized.includes("brunch")) {
    return [
      { sku: "EGGS_12", quantityMilli: Math.ceil(people / 12) * 1_000 },
      { sku: "TOMATO", quantityMilli: scaled(1_000, people) },
      { sku: "PARSLEY", quantityMilli: Math.ceil(people / 6) * 1_000 },
      { sku: "BREAD_WHITE", quantityMilli: Math.ceil(people / 4) * 1_000 },
      { sku: "SIMIT", quantityMilli: people * 1_000 },
      { sku: "OIL_OLIVE", quantityMilli: 500 },
    ];
  }

  if (
    normalized.includes("barbecue") ||
    normalized.includes("bbq") ||
    normalized.includes("grill")
  ) {
    return [
      { sku: "BEEF_STEAK", quantityMilli: scaled(1_000, people) },
      { sku: "LAMB_CHOP", quantityMilli: scaled(1_000, people) },
      { sku: "TOMATO", quantityMilli: scaled(1_000, people) },
      { sku: "ONION", quantityMilli: scaled(750, people) },
      { sku: "PEPPER_GREEN", quantityMilli: scaled(750, people) },
      { sku: "PIDE", quantityMilli: people * 1_000 },
      { sku: "CHARCOAL", quantityMilli: scaled(3_000, people) },
    ];
  }

  return [
    { sku: "BEEF_GROUND", quantityMilli: scaled(1_000, people) },
    { sku: "ONION", quantityMilli: scaled(500, people) },
    { sku: "PARSLEY", quantityMilli: Math.ceil(people / 6) * 1_000 },
    { sku: "BREAD_WHITE", quantityMilli: Math.ceil(people / 4) * 1_000 },
    { sku: "SALT", quantityMilli: 100 },
    { sku: "PEPPER_BLACK", quantityMilli: 1_000 },
    { sku: "CUMIN", quantityMilli: 1_000 },
    { sku: "TOMATO_PASTE", quantityMilli: 1_000 },
  ];
}

function touch(task: DemoTask) {
  task.updatedAt = new Date().toISOString();
}

function addEvent(
  task: DemoTask,
  type: DemoEvent["type"],
  title: string,
  detail: string,
) {
  task.events.push({
    id: randomUUID(),
    type,
    title,
    detail,
    createdAt: new Date().toISOString(),
  });
  touch(task);
}

type QuoteCandidate = { quote: Quote; merchant: Merchant };

function availableCandidates(candidates: QuoteCandidate[], sku: Sku) {
  return candidates.flatMap((candidate) => {
    const item = candidate.quote.items.find(
      (line) => line.sku === sku && line.available,
    );
    return item ? [{ ...candidate, item }] : [];
  });
}

function basketize(
  selections: Array<{ quote: Quote; item: QuoteItem }>,
): MerchantBasket[] {
  const groups = new Map<string, MerchantBasket>();
  for (const { quote, item } of selections) {
    const existing = groups.get(quote.merchantId);
    if (existing) {
      existing.items.push(item);
      existing.subtotalMicroUsdc = (
        BigInt(existing.subtotalMicroUsdc) + BigInt(item.totalPriceMicroUsdc)
      ).toString();
    } else {
      groups.set(quote.merchantId, {
        merchantId: quote.merchantId,
        merchantName: quote.merchantName,
        merchantWallet: quote.merchantWallet,
        quoteId: quote.id,
        items: [item],
        subtotalMicroUsdc: item.totalPriceMicroUsdc,
      });
    }
  }
  return [...groups.values()];
}

function makeOption(
  strategy: ShoppingOption["strategy"],
  title: string,
  description: string,
  selections: Array<{ quote: Quote; item: QuoteItem }>,
): ShoppingOption {
  const merchantBaskets = basketize(selections);
  return {
    id: randomUUID(),
    strategy,
    title,
    description,
    merchantBaskets,
    totalMicroUsdc: merchantBaskets
      .reduce((total, basket) => total + BigInt(basket.subtotalMicroUsdc), 0n)
      .toString(),
    itemCount: selections.length,
  };
}

function buildOptions(
  items: SkuRequest[],
  candidates: QuoteCandidate[],
): ShoppingOption[] {
  const cheapest = items.map(({ sku }) => {
    const matches = availableCandidates(candidates, sku).sort((a, b) =>
      Number(
        BigInt(a.item.totalPriceMicroUsdc) - BigInt(b.item.totalPriceMicroUsdc),
      ),
    );
    if (!matches[0]) throw new Error(`No merchant can fulfill ${sku}`);
    return { quote: matches[0].quote, item: matches[0].item };
  });

  const quality = items.map(({ sku }) => {
    const matches = availableCandidates(candidates, sku).sort(
      (a, b) => b.merchant.qualityScore - a.merchant.qualityScore,
    );
    if (!matches[0]) throw new Error(`No merchant can fulfill ${sku}`);
    return { quote: matches[0].quote, item: matches[0].item };
  });

  const remaining = new Set(items.map((item) => item.sku));
  const fewest: Array<{ quote: Quote; item: QuoteItem }> = [];
  while (remaining.size > 0) {
    const best = candidates
      .map((candidate) => ({
        candidate,
        lines: candidate.quote.items.filter(
          (item) => item.available && remaining.has(item.sku),
        ),
      }))
      .sort((a, b) => b.lines.length - a.lines.length)[0];
    if (!best || best.lines.length === 0)
      throw new Error("Merchant coverage is incomplete");
    for (const item of best.lines) {
      fewest.push({ quote: best.candidate.quote, item });
      remaining.delete(item.sku);
    }
  }

  return [
    makeOption(
      "lowest_cost",
      "Lowest total",
      "The cheapest verified line item from each merchant.",
      cheapest,
    ),
    makeOption(
      "best_quality",
      "Quality first",
      "Prioritizes the highest-rated merchant for every item.",
      quality,
    ),
    makeOption(
      "fewest_stops",
      "Fewest stops",
      "Greedy route plan that minimizes merchant pickups.",
      fewest,
    ),
  ];
}

export function createTask(prompt: string): DemoTask {
  const now = new Date().toISOString();
  const task: DemoTask = {
    id: randomUUID(),
    prompt,
    status: "parsing",
    mode: isDemoMode() ? "local_demo" : "arc_testnet",
    requestedItems: [],
    events: [],
    payments: [],
    quotes: [],
    options: [],
    orders: [],
    createdAt: now,
    updatedAt: now,
  };
  tasks.set(task.id, task);
  void runTask(task);
  return task;
}

async function runTask(task: DemoTask) {
  try {
    const merchantApiUrl =
      process.env.MERCHANT_API_URL ?? "http://localhost:4000";
    addEvent(
      task,
      "intent",
      "Intent received",
      "The agent is converting the request into deterministic SKUs.",
    );
    await wait(450);
    task.requestedItems = parseShoppingIntent(task.prompt);
    addEvent(
      task,
      "intent",
      `${task.requestedItems.length} items verified`,
      "Quantities were scaled from the number of people in the request.",
    );

    task.status = "discovering";
    await wait(450);
    const merchantResponse = await fetch(`${merchantApiUrl}/merchants`);
    if (!merchantResponse.ok)
      throw new Error("Merchant discovery service is unavailable");
    const merchants = (await merchantResponse.json()) as Merchant[];
    addEvent(
      task,
      "discovery",
      `${merchants.length} merchants discovered`,
      "Candidates ranked by coverage, price, and quality.",
    );

    await assertResearchBalance(merchants.length);

    task.status = "quoting";
    for (const merchant of merchants) {
      await wait(220);
      const result = await buySignedQuote({
        merchant,
        merchantApiUrl,
        taskId: task.id,
        items: task.requestedItems,
      });
      task.quotes.push(result.quote);
      task.payments.push(result.payment);
      addEvent(
        task,
        "payment",
        `Paid ${merchant.name}`,
        result.payment.mode === "gateway"
          ? `0.0005 USDC settled through Circle Gateway · ${result.payment.transaction}`
          : "0.0005 USDC research payment · local simulation",
      );
    }

    const candidates = task.quotes.map((quote) => ({
      quote,
      merchant: merchants.find((merchant) => merchant.id === quote.merchantId)!,
    }));
    task.options = buildOptions(task.requestedItems, candidates);
    task.status = "awaiting_selection";
    addEvent(
      task,
      "decision",
      "Three plans are ready",
      `${task.payments.length} signed quotes compared within the 0.01 USDC research cap.`,
    );
  } catch (error) {
    task.status = "error";
    task.error =
      error instanceof Error ? error.message : "Unknown task failure";
    addEvent(task, "decision", "Task failed", task.error);
  }
  touch(task);
}

export function getTask(id: string) {
  return tasks.get(id);
}

export function listTasks() {
  return [...tasks.values()].sort((a, b) =>
    b.createdAt.localeCompare(a.createdAt),
  );
}

export function resetDemo() {
  tasks.clear();
}

export function selectOption(taskId: string, optionId: string) {
  const task = tasks.get(taskId);
  if (!task) throw new Error("Task not found");
  if (task.status !== "awaiting_selection")
    throw new Error("Task is not awaiting a selection");
  const option = task.options.find((candidate) => candidate.id === optionId);
  if (!option) throw new Error("Option not found");

  task.selectedOptionId = optionId;
  task.status = "monitoring";
  const now = new Date().toISOString();
  task.orders = option.merchantBaskets.map((basket) => ({
    id: randomUUID(),
    taskId,
    merchantId: basket.merchantId,
    merchantName: basket.merchantName,
    merchantWallet: basket.merchantWallet,
    items: basket.items,
    totalMicroUsdc: basket.subtotalMicroUsdc,
    status: "funded",
    pickupCode: String(Math.floor(100_000 + Math.random() * 900_000)),
    escrowReference: `0x${randomBytes(32).toString("hex")}`,
    paymentMode: "simulated",
    createdAt: now,
    updatedAt: now,
  }));
  addEvent(
    task,
    "order",
    `${task.orders.length} orders funded`,
    "Demo escrow references created. Merchants can now accept the orders.",
  );
  return task;
}

const transitions: Record<DemoOrderStatus, DemoOrderStatus | undefined> = {
  funded: "preparing",
  preparing: "ready",
  ready: "completed",
  completed: undefined,
};

export function updateOrder(orderId: string, status: DemoOrderStatus) {
  for (const task of tasks.values()) {
    const order = task.orders.find((candidate) => candidate.id === orderId);
    if (!order) continue;
    if (transitions[order.status] !== status)
      throw new Error(`Cannot move ${order.status} to ${status}`);
    order.status = status;
    order.updatedAt = new Date().toISOString();
    addEvent(
      task,
      "order",
      `${order.merchantName}: ${status}`,
      `Order ${order.id.slice(0, 8)} moved to ${status}.`,
    );
    if (task.orders.every((candidate) => candidate.status === "completed")) {
      task.status = "completed";
      addEvent(
        task,
        "order",
        "Shopping task completed",
        "Every merchant confirmed pickup and the demo escrow was released.",
      );
    }
    return order;
  }
  throw new Error("Order not found");
}

export function listOrders() {
  return listTasks().flatMap((task) => task.orders);
}
