"use client";

import { useEffect, useState } from "react";
import type {
  DemoOrder,
  DemoTask,
  MerchantOrder,
  ShoppingOption,
} from "@errand/shared";
import {
  connectArcWallet,
  formatPickupProof,
  fundEscrowOrder,
  type EscrowConfig,
} from "@/lib/arc-escrow";

const agentUrl = process.env.NEXT_PUBLIC_AGENT_URL ?? "http://localhost:3001";
const demoMode = process.env.NEXT_PUBLIC_DEMO_MODE !== "false";
const arcExplorerUrl = "https://testnet.arcscan.app";
const suggestions = [
  "I am making meatballs for 4 people",
  "Sunday breakfast for 6 people",
  "A barbecue for 8 people",
] as const;

const formatUsdc = (microUsdc: string) =>
  (Number(microUsdc) / 1_000_000).toFixed(2);
const formatResearchUsdc = (microUsdc: string) =>
  (Number(microUsdc) / 1_000_000).toFixed(4);
const shortHash = (value: string) => `${value.slice(0, 8)}…${value.slice(-6)}`;

function hydrateShopperSecrets(task: DemoTask): DemoTask {
  return {
    ...task,
    orders: task.orders.map((order) => {
      if (order.paymentMode !== "arc_testnet") return order;
      const key = `errand-pickup:${order.id}`;
      const stored = window.sessionStorage.getItem(key);
      if (stored) {
        try {
          const candidate = JSON.parse(stored) as {
            pickupCode?: string;
            deliveryCodeSalt?: string;
          };
          if (
            candidate.pickupCode?.match(/^\d{6}$/) &&
            candidate.deliveryCodeSalt?.match(/^0x[0-9a-fA-F]{64}$/)
          ) {
            return { ...order, ...candidate };
          }
        } catch {
          window.sessionStorage.removeItem(key);
        }
      }
      const randomNumber = window.crypto.getRandomValues(
        new Uint32Array(1),
      )[0]!;
      const pickupCode = String(100_000 + (randomNumber % 900_000));
      const saltBytes = window.crypto.getRandomValues(new Uint8Array(32));
      const deliveryCodeSalt = `0x${Array.from(saltBytes, (byte) =>
        byte.toString(16).padStart(2, "0"),
      ).join("")}`;
      const secret = { pickupCode, deliveryCodeSalt };
      window.sessionStorage.setItem(key, JSON.stringify(secret));
      return { ...order, ...secret };
    }),
  };
}

export function ShopComposer() {
  const [prompt, setPrompt] = useState<string>(suggestions[0]);
  const [task, setTask] = useState<DemoTask | null>(null);
  const [busy, setBusy] = useState(false);
  const [busyOrder, setBusyOrder] = useState("");
  const [error, setError] = useState("");
  const [escrowConfig, setEscrowConfig] = useState<EscrowConfig | null>(null);

  useEffect(() => {
    const savedTaskId = window.localStorage.getItem("errand-demo-task");
    if (!savedTaskId) return;
    void fetch(`${agentUrl}/tasks/${savedTaskId}`).then(async (response) => {
      if (response.ok)
        setTask(hydrateShopperSecrets((await response.json()) as DemoTask));
    });
  }, []);

  useEffect(() => {
    void fetch(`${agentUrl}/escrow/config`).then(async (response) => {
      if (response.ok) setEscrowConfig((await response.json()) as EscrowConfig);
    });
  }, []);

  const taskId = task?.id;
  const taskStatus = task?.status;

  useEffect(() => {
    if (
      !taskId ||
      !taskStatus ||
      ["awaiting_selection", "completed", "error"].includes(taskStatus)
    )
      return;
    const timer = window.setInterval(() => {
      void fetch(`${agentUrl}/tasks/${taskId}`).then(async (response) => {
        if (response.ok)
          setTask(hydrateShopperSecrets((await response.json()) as DemoTask));
      });
    }, 550);
    return () => window.clearInterval(timer);
  }, [taskId, taskStatus]);

  async function startTask() {
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`${agentUrl}/tasks`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ prompt }),
      });
      if (!response.ok) throw new Error("Could not start the shopping agent");
      const created = (await response.json()) as DemoTask;
      window.localStorage.setItem("errand-demo-task", created.id);
      setTask(hydrateShopperSecrets(created));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unexpected error");
    } finally {
      setBusy(false);
    }
  }

  async function fundOrder(order: DemoOrder) {
    if (!escrowConfig?.enabled || !escrowConfig.contractAddress) {
      setError("The Arc escrow contract has not been deployed/configured yet");
      return;
    }
    setBusyOrder(order.id);
    setError("");
    try {
      const session = await connectArcWallet();
      const { transactionHash } = await fundEscrowOrder(
        session,
        escrowConfig,
        order,
      );
      const response = await fetch(`${agentUrl}/orders/${order.id}/sync`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ transactionHash }),
      });
      if (!response.ok) throw new Error("Arc funding could not be verified");
      const updated = (await response.json()) as MerchantOrder;
      setTask((current) =>
        current
          ? {
              ...current,
              orders: current.orders.map((candidate) =>
                candidate.id === updated.id
                  ? { ...candidate, ...updated }
                  : candidate,
              ),
            }
          : current,
      );
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Wallet funding failed",
      );
    } finally {
      setBusyOrder("");
    }
  }

  async function selectPlan(option: ShoppingOption) {
    if (!task) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`${agentUrl}/tasks/${task.id}/select`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ optionId: option.id }),
      });
      if (!response.ok)
        throw new Error("Could not fund the selected demo plan");
      setTask(hydrateShopperSecrets((await response.json()) as DemoTask));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unexpected error");
    } finally {
      setBusy(false);
    }
  }

  function resetDemo() {
    task?.orders.forEach((order) =>
      window.sessionStorage.removeItem(`errand-pickup:${order.id}`),
    );
    window.localStorage.removeItem("errand-demo-task");
    void fetch(`${agentUrl}/demo`, { method: "DELETE" });
    setTask(null);
    setError("");
  }

  return (
    <div className="mt-10 space-y-6">
      <section className="rounded-3xl border border-border bg-surface p-4 shadow-2xl shadow-black/20 sm:p-6">
        <label htmlFor="shopping-prompt" className="sr-only">
          Shopping request
        </label>
        <textarea
          id="shopping-prompt"
          value={prompt}
          onChange={(event) => setPrompt(event.target.value.slice(0, 500))}
          placeholder="Example: I am making meatballs for 4 people"
          className="min-h-28 w-full resize-none bg-transparent p-2 text-lg leading-8 text-foreground outline-none placeholder:text-muted sm:text-xl"
        />
        <div className="flex flex-wrap gap-2 border-t border-border pt-4">
          {suggestions.map((suggestion) => (
            <button
              key={suggestion}
              type="button"
              onClick={() => setPrompt(suggestion)}
              className="rounded-full border border-border bg-background px-3 py-2 text-xs text-secondary transition hover:border-accent/50 hover:text-foreground"
            >
              {suggestion}
            </button>
          ))}
        </div>
        <div className="mt-4 flex items-center justify-between gap-4">
          <span className="font-mono text-[10px] text-muted">
            {prompt.length}/500
          </span>
          <div className="flex gap-2">
            {task && (
              <button
                type="button"
                onClick={resetDemo}
                className="button-secondary"
              >
                New task
              </button>
            )}
            <button
              type="button"
              onClick={startTask}
              disabled={busy || prompt.trim().length < 8}
              className="button-primary disabled:cursor-not-allowed disabled:opacity-40"
            >
              {busy ? "Working…" : "Start agent"} <span>→</span>
            </button>
          </div>
        </div>
        <p className="mt-4 text-xs text-muted">
          {demoMode
            ? "Demo mode signs every quote cryptographically and simulates the 0.0005 USDC x402 settlement. No testnet funds move."
            : "Arc Testnet mode pays 0.0005 USDC per quote through Circle Gateway; every basket requires explicit shopper-wallet escrow funding."}
        </p>
      </section>

      {error && (
        <div className="rounded-2xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-200">
          {error}
        </div>
      )}
      {task && (
        <TaskView
          task={task}
          busy={busy}
          busyOrder={busyOrder}
          escrowConfig={escrowConfig}
          onSelect={selectPlan}
          onFund={fundOrder}
        />
      )}
    </div>
  );
}

function TaskView({
  task,
  busy,
  busyOrder,
  escrowConfig,
  onSelect,
  onFund,
}: {
  task: DemoTask;
  busy: boolean;
  busyOrder: string;
  escrowConfig: EscrowConfig | null;
  onSelect: (option: ShoppingOption) => void;
  onFund: (order: DemoOrder) => void;
}) {
  const researchSpend = task.payments.reduce(
    (sum, payment) => sum + Number(payment.amountMicroUsdc),
    0,
  );
  return (
    <div className="grid gap-6 lg:grid-cols-[0.82fr_1.18fr]">
      <section className="rounded-3xl border border-border bg-surface p-5 sm:p-6">
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-sm font-medium">Agent activity</p>
            <p className="mt-1 font-mono text-[10px] uppercase tracking-wider text-muted">
              Task {task.id.slice(0, 8)}
            </p>
          </div>
          <StatusBadge status={task.status} />
        </div>
        <div className="mt-6 space-y-3">
          {task.events.map((event) => (
            <div
              key={event.id}
              className="flex gap-3 rounded-2xl border border-border-subtle bg-background/55 p-3"
            >
              <span className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-accent-soft text-xs text-accent">
                {event.type === "payment" ? "◈" : "✓"}
              </span>
              <div>
                <p className="text-sm text-foreground">{event.title}</p>
                <p className="mt-1 text-xs leading-5 text-muted">
                  {event.detail}
                </p>
              </div>
            </div>
          ))}
          {!["awaiting_selection", "monitoring", "completed", "error"].includes(
            task.status,
          ) && (
            <div className="flex items-center gap-3 px-2 py-3 text-xs text-secondary">
              <span className="h-2 w-2 animate-pulse rounded-full bg-accent" />{" "}
              Agent is working…
            </div>
          )}
        </div>
        <div className="mt-5 grid grid-cols-3 gap-3">
          <Metric label="Signed quotes" value={String(task.quotes.length)} />
          <Metric
            label="Research spend"
            value={`${(researchSpend / 1_000_000).toFixed(4)} USDC`}
          />
          <Metric
            label="Budget left"
            value={`${formatResearchUsdc(task.remainingResearchBudgetMicroUsdc)} USDC`}
          />
        </div>
        {task.merchantDecisions.length > 0 && (
          <div className="mt-4 space-y-2 rounded-2xl border border-info/20 bg-info/5 p-4">
            <p className="text-[10px] uppercase tracking-wider text-info">
              Autonomous query policy
            </p>
            {task.merchantDecisions.map((decision) => (
              <div
                key={decision.merchantId}
                className="flex items-center justify-between gap-3 text-xs"
              >
                <span
                  className={
                    decision.selected ? "text-secondary" : "text-muted"
                  }
                >
                  {decision.selected ? "Paid query" : "Skipped"} ·{" "}
                  {decision.merchantName}
                </span>
                <span className="font-mono text-muted">
                  score {decision.score.toFixed(3)} · {decision.distanceMeters}m
                </span>
              </div>
            ))}
          </div>
        )}
        {task.payments.some((payment) => payment.mode === "gateway") && (
          <div className="mt-4 space-y-2">
            <p className="text-[10px] uppercase tracking-wider text-muted">
              Gateway settlement evidence
            </p>
            {task.payments.map((payment) => {
              const canLink = Boolean(
                payment.transaction?.match(/^0x[0-9a-fA-F]{64}$/),
              );
              return (
                <div
                  key={payment.id}
                  className="rounded-xl border border-border-subtle bg-background/40 p-3 text-xs"
                >
                  <div className="flex items-center justify-between gap-3">
                    <span className="truncate text-secondary">
                      {payment.merchantName} ·{" "}
                      {formatResearchUsdc(payment.amountMicroUsdc)} USDC
                    </span>
                    {canLink ? (
                      <a
                        className="font-mono text-accent hover:underline"
                        href={`${arcExplorerUrl}/tx/${payment.transaction}`}
                        target="_blank"
                        rel="noreferrer"
                      >
                        {shortHash(payment.transaction!)}
                      </a>
                    ) : (
                      <span className="font-mono text-muted">
                        {payment.transaction
                          ? shortHash(payment.transaction)
                          : "settled"}
                      </span>
                    )}
                  </div>
                  <p className="mt-2 truncate font-mono text-[10px] text-muted">
                    {payment.network} · {payment.endpoint} · payee{" "}
                    {shortHash(payment.payee)}
                  </p>
                </div>
              );
            })}
          </div>
        )}
      </section>

      <section className="space-y-4">
        {task.options.length > 0 && !task.selectedOptionId && (
          <>
            <div>
              <p className="text-sm font-medium">Choose a verified plan</p>
              <p className="mt-1 text-xs text-muted">
                {demoMode
                  ? "Selecting a plan creates local escrow orders for the merchant console."
                  : "Selecting a plan prepares Arc escrows; your wallet still approves every purchase."}
              </p>
            </div>
            {task.options.map((option) => (
              <OptionCard
                key={option.id}
                option={option}
                busy={busy}
                onSelect={() => onSelect(option)}
              />
            ))}
          </>
        )}
        {task.orders.length > 0 && (
          <OrderTracker
            task={task}
            busyOrder={busyOrder}
            escrowConfig={escrowConfig}
            onFund={onFund}
          />
        )}
        {task.status === "error" && (
          <div className="rounded-3xl border border-red-500/30 bg-red-500/10 p-6">
            <p className="font-medium text-red-100">The task stopped</p>
            <p className="mt-2 text-sm text-red-200/70">{task.error}</p>
          </div>
        )}
      </section>
    </div>
  );
}

function OptionCard({
  option,
  busy,
  onSelect,
}: {
  option: ShoppingOption;
  busy: boolean;
  onSelect: () => void;
}) {
  return (
    <article className="rounded-3xl border border-border bg-surface p-5 transition hover:border-accent/35">
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-start">
        <div>
          <p className="text-lg font-medium">{option.title}</p>
          <p className="mt-1 text-sm text-muted">{option.description}</p>
          <p className="mt-3 text-xs text-secondary">
            {option.itemCount} items · {option.merchantBaskets.length} merchant
            {option.merchantBaskets.length === 1 ? "" : "s"}
          </p>
        </div>
        <div className="shrink-0 text-left sm:text-right">
          <p className="font-mono text-2xl font-semibold">
            {formatUsdc(option.totalMicroUsdc)}{" "}
            <span className="text-xs text-muted">USDC</span>
          </p>
          <button
            type="button"
            disabled={busy}
            onClick={onSelect}
            className="mt-3 rounded-xl bg-accent px-4 py-2 text-xs font-semibold text-black disabled:opacity-40"
          >
            {demoMode ? "Create demo orders" : "Prepare Arc orders"}
          </button>
        </div>
      </div>
      <div className="mt-4 flex flex-wrap gap-2">
        {option.merchantBaskets.map((basket) => (
          <span
            key={basket.merchantId}
            className="rounded-full border border-border bg-background px-3 py-1.5 text-[11px] text-secondary"
          >
            {basket.merchantName} · {basket.items.length}
          </span>
        ))}
      </div>
    </article>
  );
}

function OrderTracker({
  task,
  busyOrder,
  escrowConfig,
  onFund,
}: {
  task: DemoTask;
  busyOrder: string;
  escrowConfig: EscrowConfig | null;
  onFund: (order: DemoOrder) => void;
}) {
  return (
    <div className="space-y-4">
      <div>
        <p className="text-sm font-medium">Live order tracking</p>
        <p className="mt-1 text-xs text-muted">
          {demoMode
            ? "Open the merchant console in another tab and move each order forward."
            : "Fund with the shopper wallet, then let each merchant advance the verified Arc escrow."}
        </p>
      </div>
      {task.orders.map((order) => (
        <article
          key={order.id}
          className="rounded-3xl border border-border bg-surface p-5"
        >
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="font-medium">{order.merchantName}</p>
              <p className="mt-1 font-mono text-[10px] text-muted">
                {shortHash(order.escrowReference)} ·{" "}
                {order.paymentMode === "arc_testnet"
                  ? "Arc escrow"
                  : "simulated escrow"}
              </p>
            </div>
            <StatusBadge status={order.status} />
          </div>
          <div className="mt-4 space-y-2">
            {order.items.map((item) => (
              <div
                key={item.sku}
                className="flex justify-between gap-4 text-xs"
              >
                <span className="text-secondary">
                  {item.name} · {item.quantityMilli / 1_000} {item.unit}
                </span>
                <span className="font-mono">
                  {formatUsdc(item.totalPriceMicroUsdc)}
                </span>
              </div>
            ))}
          </div>
          <div className="mt-4 flex items-center justify-between border-t border-border pt-4">
            <div className="text-xs text-muted">
              {order.status === "completed" ? (
                <span>Pickup confirmed · USDC released</span>
              ) : (
                <>
                  Pickup code{" "}
                  {order.status === "ready" ? (
                    <strong className="ml-2 font-mono text-foreground">
                      {order.pickupCode}
                    </strong>
                  ) : (
                    "revealed when ready"
                  )}
                </>
              )}
              {order.status === "ready" &&
                order.paymentMode === "arc_testnet" && (
                  <button
                    type="button"
                    className="mt-2 block font-mono text-[10px] text-accent hover:underline"
                    onClick={() =>
                      void navigator.clipboard.writeText(
                        formatPickupProof(order),
                      )
                    }
                  >
                    Copy pickup proof
                  </button>
                )}
              {order.lastTransaction && (
                <a
                  className="mt-2 block font-mono text-[10px] text-accent hover:underline"
                  href={`${arcExplorerUrl}/tx/${order.lastTransaction}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  Verify {shortHash(order.lastTransaction)} ↗
                </a>
              )}
            </div>
            <div className="text-right">
              <span className="block font-mono text-sm">
                {formatUsdc(order.totalMicroUsdc)} USDC
              </span>
              {order.status === "awaiting_funding" && (
                <button
                  type="button"
                  disabled={busyOrder === order.id || !escrowConfig?.enabled}
                  onClick={() => onFund(order)}
                  className="mt-2 rounded-xl bg-accent px-4 py-2 text-xs font-semibold text-black disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {busyOrder === order.id
                    ? "Waiting for wallet…"
                    : escrowConfig?.enabled
                      ? "Approve & fund"
                      : "Deploy escrow first"}
                </button>
              )}
            </div>
          </div>
        </article>
      ))}
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  return (
    <span className="rounded-full border border-border bg-background px-3 py-1.5 font-mono text-[10px] uppercase tracking-wider text-accent">
      {status.replaceAll("_", " ")}
    </span>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-border-subtle bg-background/60 p-3">
      <p className="font-mono text-sm text-foreground">{value}</p>
      <p className="mt-1 text-[10px] uppercase tracking-wider text-muted">
        {label}
      </p>
    </div>
  );
}
