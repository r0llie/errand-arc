"use client";

import { useEffect, useState } from "react";
import type {
  DemoOrderStatus,
  MerchantOrder,
  MerchantPaymentReceipt,
} from "@errand/shared";
import {
  advanceEscrowOrder,
  connectArcWallet,
  parsePickupProof,
  type EscrowConfig,
} from "@/lib/arc-escrow";

const agentUrl = process.env.NEXT_PUBLIC_AGENT_URL ?? "http://localhost:3001";
const merchantApiUrl =
  process.env.NEXT_PUBLIC_MERCHANT_API_URL ?? "http://localhost:4000";
const demoMode = process.env.NEXT_PUBLIC_DEMO_MODE !== "false";
const arcExplorerUrl = "https://testnet.arcscan.app";
const formatUsdc = (microUsdc: string) =>
  (Number(microUsdc) / 1_000_000).toFixed(2);
const nextStatus: Partial<Record<DemoOrderStatus, DemoOrderStatus>> = {
  funded: "preparing",
  preparing: "ready",
  ready: "completed",
};
const actionLabel: Partial<Record<DemoOrderStatus, string>> = {
  funded: "Accept & prepare",
  preparing: "Mark ready",
  ready: "Confirm pickup",
};

export function MerchantConsole() {
  const [orders, setOrders] = useState<MerchantOrder[]>([]);
  const [receipts, setReceipts] = useState<MerchantPaymentReceipt[]>([]);
  const [merchantId, setMerchantId] = useState("all");
  const [busyOrder, setBusyOrder] = useState("");
  const [pickupProofs, setPickupProofs] = useState<Record<string, string>>({});
  const [escrowConfig, setEscrowConfig] = useState<EscrowConfig | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    const refresh = () => {
      void Promise.all([
        fetch(`${agentUrl}/merchant/orders`),
        fetch(`${merchantApiUrl}/receipts`),
        fetch(`${agentUrl}/escrow/config`),
      ])
        .then(async ([ordersResponse, receiptsResponse, configResponse]) => {
          if (!active) return;
          if (ordersResponse.ok)
            setOrders((await ordersResponse.json()) as MerchantOrder[]);
          if (receiptsResponse.ok)
            setReceipts(
              (await receiptsResponse.json()) as MerchantPaymentReceipt[],
            );
          if (configResponse.ok)
            setEscrowConfig((await configResponse.json()) as EscrowConfig);
        })
        .catch(() => active && setError("Local services are not reachable"));
    };
    refresh();
    const timer = window.setInterval(refresh, 700);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, []);

  const merchants = [
    ...new Map(
      orders.map((order) => [order.merchantId, order.merchantName]),
    ).entries(),
  ];
  const visibleOrders =
    merchantId === "all"
      ? orders
      : orders.filter((order) => order.merchantId === merchantId);

  async function advance(order: MerchantOrder) {
    const status = nextStatus[order.status];
    if (!status) return;
    setBusyOrder(order.id);
    setError("");
    try {
      if (!demoMode) {
        if (!escrowConfig?.enabled || !escrowConfig.contractAddress) {
          throw new Error("The Arc escrow contract is not configured");
        }
        if (order.status === "ready") {
          parsePickupProof(pickupProofs[order.id] ?? "");
        }
        const session = await connectArcWallet();
        const transactionHash = await advanceEscrowOrder(
          session,
          escrowConfig,
          order,
          pickupProofs[order.id],
        );
        const syncResponse = await fetch(
          `${agentUrl}/orders/${order.id}/sync`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ transactionHash }),
          },
        );
        if (!syncResponse.ok)
          throw new Error("Arc update could not be verified");
        const updated = (await syncResponse.json()) as MerchantOrder;
        setOrders((current) =>
          current.map((candidate) =>
            candidate.id === updated.id ? updated : candidate,
          ),
        );
        return;
      }
      const response = await fetch(
        `${agentUrl}/merchant/orders/${order.id}/status`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            status,
            pickupCode:
              order.status === "ready"
                ? pickupProofs[order.id]?.trim()
                : undefined,
          }),
        },
      );
      if (!response.ok) throw new Error("Order transition was rejected");
      const updated = (await response.json()) as MerchantOrder;
      setOrders((current) =>
        current.map((candidate) =>
          candidate.id === updated.id ? updated : candidate,
        ),
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unexpected error");
    } finally {
      setBusyOrder("");
    }
  }

  return (
    <div className="mt-10 space-y-5">
      <section className="rounded-3xl border border-border bg-surface p-5">
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="font-medium">Agent API revenue</p>
            <p className="mt-1 text-xs text-muted">
              Every paid quote request appears here from the merchant side.
            </p>
          </div>
          <span className="font-mono text-sm text-accent">
            {(
              Number(
                receipts.reduce(
                  (total, receipt) => total + BigInt(receipt.amountMicroUsdc),
                  0n,
                ),
              ) / 1_000_000
            ).toFixed(4)}{" "}
            USDC
          </span>
        </div>
        <div className="mt-4 grid gap-2 md:grid-cols-2">
          {receipts.length === 0 ? (
            <p className="text-xs text-muted">
              No quote payments received yet.
            </p>
          ) : (
            receipts.slice(0, 8).map((receipt) => (
              <div
                key={receipt.id}
                className="rounded-2xl border border-border-subtle bg-background/50 p-3"
              >
                <div className="flex items-center justify-between gap-3 text-xs">
                  <span className="text-secondary">{receipt.merchantName}</span>
                  <span className="font-mono text-success">
                    +{(Number(receipt.amountMicroUsdc) / 1_000_000).toFixed(4)}{" "}
                    USDC
                  </span>
                </div>
                <p className="mt-2 truncate font-mono text-[10px] text-muted">
                  {receipt.mode} · {receipt.network} · payer{" "}
                  {receipt.payer.slice(0, 8)}…
                </p>
              </div>
            ))
          )}
        </div>
      </section>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => setMerchantId("all")}
          className={`rounded-full border px-3 py-2 text-xs ${merchantId === "all" ? "border-accent bg-accent-soft text-accent" : "border-border text-secondary"}`}
        >
          All merchants
        </button>
        {merchants.map(([id, name]) => (
          <button
            key={id}
            type="button"
            onClick={() => setMerchantId(id)}
            className={`rounded-full border px-3 py-2 text-xs ${merchantId === id ? "border-accent bg-accent-soft text-accent" : "border-border text-secondary"}`}
          >
            {name}
          </button>
        ))}
      </div>
      {error && (
        <div className="rounded-2xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-200">
          {error}
        </div>
      )}
      {visibleOrders.length === 0 ? (
        <div className="rounded-3xl border border-dashed border-border bg-surface/40 px-6 py-16 text-center">
          <p className="text-lg font-medium">No funded orders yet</p>
          <p className="mt-2 text-sm text-muted">
            Start a shopper task, choose a plan, then return to this tab.
          </p>
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {visibleOrders.map((order) => (
            <article
              key={order.id}
              className="rounded-3xl border border-border bg-surface p-5"
            >
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="font-medium">{order.merchantName}</p>
                  <p className="mt-1 font-mono text-[10px] text-muted">
                    ORDER {order.id.slice(0, 8)}
                  </p>
                </div>
                <span className="rounded-full border border-border bg-background px-3 py-1.5 font-mono text-[10px] uppercase text-accent">
                  {order.status}
                </span>
              </div>
              <div className="mt-5 space-y-2">
                {order.items.map((item) => (
                  <div
                    key={item.sku}
                    className="flex justify-between gap-4 text-sm"
                  >
                    <span className="text-secondary">
                      {item.quantityMilli / 1_000} {item.unit} · {item.name}
                    </span>
                    <span className="font-mono text-xs">
                      {formatUsdc(item.totalPriceMicroUsdc)}
                    </span>
                  </div>
                ))}
              </div>
              <div className="mt-5 flex items-end justify-between gap-4 border-t border-border pt-4">
                <div>
                  <p className="font-mono text-lg">
                    {formatUsdc(order.totalMicroUsdc)} USDC
                  </p>
                  {order.status === "ready" && (
                    <label className="mt-2 block text-xs text-muted">
                      {demoMode
                        ? "Enter the shopper's 6-digit pickup code"
                        : "Paste the shopper's pickup proof"}
                      <input
                        className="mt-2 block w-full rounded-lg border border-border bg-background px-3 py-2 font-mono text-xs text-foreground outline-none focus:border-accent"
                        value={pickupProofs[order.id] ?? ""}
                        onChange={(event) =>
                          setPickupProofs((current) => ({
                            ...current,
                            [order.id]: event.target.value,
                          }))
                        }
                        placeholder={demoMode ? "123456" : "123456:0x…"}
                      />
                    </label>
                  )}
                  {order.lastTransaction && (
                    <a
                      className="mt-2 block font-mono text-[10px] text-accent hover:underline"
                      href={`${arcExplorerUrl}/tx/${order.lastTransaction}`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Verify transaction ↗
                    </a>
                  )}
                </div>
                {nextStatus[order.status] && (
                  <button
                    type="button"
                    disabled={busyOrder === order.id}
                    onClick={() => advance(order)}
                    className="rounded-xl bg-accent px-4 py-2.5 text-xs font-semibold text-black disabled:opacity-40"
                  >
                    {busyOrder === order.id
                      ? "Updating…"
                      : actionLabel[order.status]}
                  </button>
                )}
                {order.status === "completed" && (
                  <span className="text-xs font-medium text-success">
                    Payment released ✓
                  </span>
                )}
              </div>
            </article>
          ))}
        </div>
      )}
      <div className="rounded-2xl border border-info/20 bg-info/5 p-4 text-xs leading-5 text-secondary">
        <strong className="text-foreground">Settlement transparency:</strong>{" "}
        quote signatures are real.
        {demoMode
          ? " Escrow and x402 settlement are explicitly simulated in the current mode."
          : " x402 quote payments settle through Circle Gateway, while merchant wallet actions and the final USDC release are verified against OrderEscrow on Arc Testnet."}
      </div>
    </div>
  );
}
