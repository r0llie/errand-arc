import { randomBytes, randomUUID } from "node:crypto";
import {
  type DemoEvent,
  type MerchantDecision,
  type DemoOrder,
  type DemoOrderStatus,
  type DemoTask,
  type MerchantOrder,
  type Merchant,
  type MerchantBasket,
  type Quote,
  type QuoteItem,
  type ShoppingOption,
  type Sku,
  type SkuRequest,
  MICROPAYMENT_COSTS,
  RESEARCH_POLICY,
  haversineMeters,
} from "@errand/shared";
import {
  ResearchBudget,
  assertResearchBalance,
  buySignedQuote,
  isDemoMode,
} from "./payments.js";
import { getGatewayClient } from "./gateway.js";

const tasks = new Map<string, DemoTask>();
const wait = (milliseconds: number) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

const scaled = (baseMilli: number, people: number) =>
  Math.max(1, Math.round((baseMilli * people) / 4));
const DEMO_LOCATION = { lat: 39.9208, lng: 32.8541 } as const;

export function rankMerchantCandidates(
  merchants: Merchant[],
  requestedItems: SkuRequest[],
): { merchants: Merchant[]; decisions: MerchantDecision[] } {
  const requested = new Set(requestedItems.map((item) => item.sku));
  const maximumPaidQueries = Math.min(
    RESEARCH_POLICY.maxQuoteMerchants,
    Number(RESEARCH_POLICY.taskCap / MICROPAYMENT_COSTS.quote),
  );
  const scored = merchants
    .map((merchant) => {
      const covered = merchant.supportedSkus.filter((sku) =>
        requested.has(sku),
      );
      const coverage = covered.length / requested.size;
      const distanceMeters = haversineMeters(
        DEMO_LOCATION.lat,
        DEMO_LOCATION.lng,
        merchant.lat,
        merchant.lng,
      );
      const distanceScore = Math.max(0, 1 - distanceMeters / 2_000);
      const score =
        0.45 * coverage +
        0.25 * (merchant.qualityScore / 10) +
        0.2 * distanceScore +
        0.1 * (merchant.canNegotiate ? 1 : 0);
      return { merchant, covered, coverage, distanceMeters, score };
    })
    .sort((a, b) => b.score - a.score);
  const selected = scored
    .filter((candidate) => candidate.covered.length > 0)
    .slice(0, maximumPaidQueries);
  const selectedIds = new Set(selected.map(({ merchant }) => merchant.id));
  return {
    merchants: selected.map(({ merchant, distanceMeters }) => ({
      ...merchant,
      distanceMeters: Math.round(distanceMeters),
    })),
    decisions: scored.map((candidate) => ({
      merchantId: candidate.merchant.id,
      merchantName: candidate.merchant.name,
      score: Number(candidate.score.toFixed(4)),
      coverage: Number(candidate.coverage.toFixed(4)),
      distanceMeters: Math.round(candidate.distanceMeters),
      selected: selectedIds.has(candidate.merchant.id),
      reason:
        candidate.covered.length === 0
          ? "Skipped: no requested SKU coverage"
          : selectedIds.has(candidate.merchant.id)
            ? `Selected: covers ${candidate.covered.length}/${requested.size} requested SKUs`
            : "Skipped: paid-query limit reached",
    })),
  };
}

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
    merchantDecisions: [],
    remainingResearchBudgetMicroUsdc: RESEARCH_POLICY.taskCap.toString(),
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
    const discoveredMerchants = (await merchantResponse.json()) as Merchant[];
    const ranked = rankMerchantCandidates(
      discoveredMerchants,
      task.requestedItems,
    );
    const merchants = ranked.merchants;
    task.merchantDecisions = ranked.decisions;
    addEvent(
      task,
      "discovery",
      `${merchants.length}/${discoveredMerchants.length} merchants selected`,
      "The agent ranked candidates by SKU coverage, quality, distance, and negotiability before spending.",
    );

    await assertResearchBalance(merchants.length);
    const budget = new ResearchBudget();
    const payerAddress = getGatewayClient().address;

    task.status = "quoting";
    for (const merchant of merchants) {
      await wait(220);
      const result = await buySignedQuote({
        merchant,
        merchantApiUrl,
        taskId: task.id,
        items: task.requestedItems,
        budget,
        payerAddress,
      });
      task.quotes.push(result.quote);
      task.payments.push(result.payment);
      task.remainingResearchBudgetMicroUsdc = budget.remaining.toString();
      addEvent(
        task,
        "payment",
        `Paid ${merchant.name}`,
        result.payment.mode === "gateway"
          ? `0.0005 USDC settled through Circle Gateway · ${result.payment.transaction}`
          : "0.0005 USDC research payment · local simulation",
      );
      addEvent(
        task,
        "quote",
        `${merchant.name} quote verified`,
        `EIP-712 signer ${result.quote.recoveredSigner.slice(0, 8)}… matches the merchant wallet; item hash, total, nonce, and expiry are valid.`,
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
  const liveEscrow = !isDemoMode();
  task.orders = option.merchantBaskets.map((basket) => ({
    id: randomUUID(),
    taskId,
    merchantId: basket.merchantId,
    merchantName: basket.merchantName,
    merchantWallet: basket.merchantWallet,
    items: basket.items,
    totalMicroUsdc: basket.subtotalMicroUsdc,
    status: liveEscrow ? "awaiting_funding" : "funded",
    pickupCode: liveEscrow
      ? undefined
      : String(Math.floor(100_000 + Math.random() * 900_000)),
    deliveryCodeSalt: liveEscrow
      ? undefined
      : `0x${randomBytes(32).toString("hex")}`,
    pickupDeadline: Math.floor(Date.now() / 1_000) + 24 * 60 * 60,
    escrowReference: `0x${randomBytes(32).toString("hex")}`,
    escrowContract: process.env.ESCROW_CONTRACT_ADDRESS || undefined,
    paymentMode: liveEscrow ? "arc_testnet" : "simulated",
    createdAt: now,
    updatedAt: now,
  }));
  addEvent(
    task,
    "order",
    liveEscrow
      ? `${task.orders.length} orders awaiting wallet funding`
      : `${task.orders.length} orders funded`,
    liveEscrow
      ? "The shopper must approve USDC and fund each Arc escrow from their wallet."
      : "Demo escrow references created. Merchants can now accept the orders.",
  );
  return task;
}

const transitions: Record<DemoOrderStatus, DemoOrderStatus | undefined> = {
  awaiting_funding: "funded",
  funded: "preparing",
  preparing: "ready",
  ready: "completed",
  completed: undefined,
  refunded: undefined,
  disputed: undefined,
};

export function updateOrder(
  orderId: string,
  status: DemoOrderStatus,
  pickupCode?: string,
) {
  if (!isDemoMode()) {
    throw new Error("Live orders can only advance from verified Arc events");
  }
  for (const task of tasks.values()) {
    const order = task.orders.find((candidate) => candidate.id === orderId);
    if (!order) continue;
    if (transitions[order.status] !== status)
      throw new Error(`Cannot move ${order.status} to ${status}`);
    if (
      status === "completed" &&
      (!order.pickupCode || pickupCode !== order.pickupCode)
    ) {
      throw new Error("Pickup code is invalid");
    }
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

export function getOrder(orderId: string) {
  return listTasks()
    .flatMap((task) => task.orders)
    .find((order) => order.id === orderId);
}

export function recordOnchainOrderState(
  orderId: string,
  input: {
    status: DemoOrderStatus;
    buyerWallet: string;
    escrowContract: string;
    transactionHash: string;
  },
) {
  for (const task of tasks.values()) {
    const order = task.orders.find((candidate) => candidate.id === orderId);
    if (!order) continue;
    if (order.paymentMode !== "arc_testnet") {
      throw new Error("Only Arc Testnet orders can be synchronized onchain");
    }
    order.status = input.status;
    order.buyerWallet = input.buyerWallet;
    order.escrowContract = input.escrowContract;
    order.lastTransaction = input.transactionHash;
    if (input.status === "funded")
      order.fundTransaction = input.transactionHash;
    if (input.status === "completed")
      order.releaseTransaction = input.transactionHash;
    order.updatedAt = new Date().toISOString();
    addEvent(
      task,
      "order",
      `${order.merchantName}: ${input.status} on Arc`,
      `Verified ${input.transactionHash.slice(0, 10)}… against the deployed escrow.`,
    );
    if (task.orders.every((candidate) => candidate.status === "completed")) {
      task.status = "completed";
      addEvent(
        task,
        "order",
        "Shopping task completed on Arc",
        "Every escrow released USDC to its merchant after pickup proof.",
      );
    } else if (
      task.orders.every((candidate) =>
        ["completed", "refunded"].includes(candidate.status),
      ) &&
      task.orders.some((candidate) => candidate.status === "refunded")
    ) {
      task.status = "refunded";
    }
    return order;
  }
  throw new Error("Order not found");
}

export function listMerchantOrders(): MerchantOrder[] {
  return listTasks().flatMap((task) => task.orders.map(redactOrder));
}

export function redactOrder({
  pickupCode: _code,
  deliveryCodeSalt: _salt,
  ...order
}: DemoOrder): MerchantOrder {
  return order;
}
