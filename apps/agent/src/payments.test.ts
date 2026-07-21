import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import type { Merchant } from "@errand/shared";
import { afterEach, describe, expect, it } from "vitest";
import {
  ResearchBudget,
  assertResearchBalance,
  inspectQuotePaymentRequirement,
  isDemoMode,
  quotePaymentRequest,
} from "./payments.js";

const originalDemoMode = process.env.DEMO_MODE;
const merchant: Merchant = {
  id: "11111111-1111-4111-8111-111111111111",
  slug: "test-merchant",
  name: "Test Merchant",
  category: "market",
  lat: 39.9208,
  lng: 32.8541,
  walletAddress: "0x1111111111111111111111111111111111111111",
  qualityScore: 9,
  canNegotiate: false,
  canReserve: false,
  supportedSkus: ["BEEF_GROUND"],
};

afterEach(() => {
  if (originalDemoMode === undefined) delete process.env.DEMO_MODE;
  else process.env.DEMO_MODE = originalDemoMode;
});

describe("Gateway research policy", () => {
  it("uses local simulation unless real mode is explicit", () => {
    delete process.env.DEMO_MODE;
    expect(isDemoMode()).toBe(true);
    process.env.DEMO_MODE = "false";
    expect(isDemoMode()).toBe(false);
  });

  it("rejects research that exceeds the task cap before payment", async () => {
    process.env.DEMO_MODE = "true";
    await expect(assertResearchBalance(21)).rejects.toThrow(
      "0.01 USDC task cap",
    );
  });

  it("reserves pending spend atomically and releases failed payments", () => {
    const budget = new ResearchBudget();
    const first = budget.reserve("task:merchant-a:quote", 500n);
    const duplicate = budget.reserve("task:merchant-a:quote", 500n);
    expect(duplicate.id).toBe(first.id);
    expect(budget.committed).toBe(500n);

    budget.reserve("task:merchant-b:quote", 500n);
    expect(budget.remaining).toBe(9_000n);
    budget.fail("task:merchant-b:quote");
    expect(budget.remaining).toBe(9_500n);
    budget.settle("task:merchant-a:quote");
    expect(budget.committed).toBe(500n);
  });

  it("enforces per-request and total task caps", () => {
    const budget = new ResearchBudget();
    expect(() => budget.reserve("too-large", 2_001n)).toThrow(
      "per-request policy",
    );
    for (let index = 0; index < 5; index += 1) {
      budget.reserve(`request-${index}`, 2_000n);
    }
    expect(() => budget.reserve("over-cap", 1n)).toThrow("task cap");
  });

  it("validates the POST 402 contract before allowing a paid quote", async () => {
    const paymentRequired = Buffer.from(
      JSON.stringify({
        x402Version: 2,
        accepts: [
          {
            scheme: "exact",
            network: "eip155:5042002",
            asset: "0x3600000000000000000000000000000000000000",
            amount: "500",
            payTo: merchant.walletAddress,
          },
        ],
      }),
    ).toString("base64");
    const server = createServer((_request, response) => {
      response.writeHead(402, { "payment-required": paymentRequired });
      response.end("{}");
    });
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    const address = server.address() as AddressInfo;
    try {
      const requirement = await inspectQuotePaymentRequirement({
        merchant,
        url: `http://127.0.0.1:${address.port}/quote`,
        requestBody: {
          taskId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          items: [{ sku: "BEEF_GROUND", quantityMilli: 1_000 }],
        },
      });
      expect(requirement.amount).toBe("500");
      expect(requirement.payTo).toBe(merchant.walletAddress);
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  });

  it("lets GatewayClient set the JSON content type exactly once", () => {
    const request = quotePaymentRequest({
      taskId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      items: [{ sku: "BEEF_GROUND", quantityMilli: 1_000 }],
    });
    expect(request).toEqual({
      method: "POST",
      body: {
        taskId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        items: [{ sku: "BEEF_GROUND", quantityMilli: 1_000 }],
      },
    });
    expect(request).not.toHaveProperty("headers");
  });
});
