import { describe, expect, it } from "vitest";
import type { Merchant } from "@errand/shared";
import {
  parseShoppingIntent,
  rankMerchantCandidates,
  redactOrder,
} from "./engine.js";

describe("parseShoppingIntent", () => {
  it("scales meatball ingredients by party size", () => {
    const items = parseShoppingIntent("I am making meatballs for 8 people");
    expect(
      items.find((item) => item.sku === "BEEF_GROUND")?.quantityMilli,
    ).toBe(2_000);
    expect(items).toHaveLength(8);
  });

  it("selects the barbecue recipe from intent", () => {
    const items = parseShoppingIntent("A barbecue for 4 people");
    expect(items.some((item) => item.sku === "CHARCOAL")).toBe(true);
    expect(items.some((item) => item.sku === "BEEF_STEAK")).toBe(true);
  });

  it("selects paid merchant queries from coverage and real-world signals", () => {
    const merchants: Merchant[] = [
      {
        id: "11111111-1111-4111-8111-111111111111",
        slug: "near-butcher",
        name: "Near Butcher",
        category: "butcher",
        lat: 39.9208,
        lng: 32.8541,
        walletAddress: "0x1111111111111111111111111111111111111111",
        qualityScore: 9,
        canNegotiate: true,
        canReserve: false,
        supportedSkus: ["BEEF_GROUND"],
      },
      {
        id: "22222222-2222-4222-8222-222222222222",
        slug: "irrelevant-shop",
        name: "Irrelevant Shop",
        category: "market",
        lat: 39.9208,
        lng: 32.8541,
        walletAddress: "0x2222222222222222222222222222222222222222",
        qualityScore: 10,
        canNegotiate: true,
        canReserve: true,
        supportedSkus: ["CHARCOAL"],
      },
    ];
    const ranked = rankMerchantCandidates(merchants, [
      { sku: "BEEF_GROUND", quantityMilli: 1_000 },
    ]);
    expect(ranked.merchants.map((merchant) => merchant.id)).toEqual([
      merchants[0]!.id,
    ]);
    expect(ranked.decisions[1]).toMatchObject({
      selected: false,
      coverage: 0,
      reason: "Skipped: no requested SKU coverage",
    });
  });

  it("never exposes the shopper pickup secret to merchant views", () => {
    const merchantOrder = redactOrder({
      id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      taskId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      merchantId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      merchantName: "Merchant",
      merchantWallet: "0x1111111111111111111111111111111111111111",
      items: [],
      totalMicroUsdc: "1000000",
      status: "ready",
      pickupCode: "123456",
      deliveryCodeSalt: `0x${"22".repeat(32)}`,
      pickupDeadline: 2_000_000_000,
      escrowReference: `0x${"33".repeat(32)}`,
      paymentMode: "arc_testnet",
      createdAt: "2026-07-21T00:00:00.000Z",
      updatedAt: "2026-07-21T00:00:00.000Z",
    });
    expect(merchantOrder).not.toHaveProperty("pickupCode");
    expect(merchantOrder).not.toHaveProperty("deliveryCodeSalt");
  });
});
