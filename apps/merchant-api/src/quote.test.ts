import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { describe, expect, it } from "vitest";
import type { MerchantRuntime } from "./catalog.js";
import { createSignedQuote } from "./quote.js";

describe("merchant quote signing", () => {
  it("binds quote items and recovers the merchant signer", async () => {
    const privateKey = generatePrivateKey();
    const account = privateKeyToAccount(privateKey);
    const merchant: MerchantRuntime = {
      id: "11111111-1111-4111-8111-111111111111",
      slug: "test-kasap",
      name: "Test Butcher",
      category: "butcher",
      lat: 39.9208,
      lng: 32.8541,
      walletAddress: account.address,
      qualityScore: 9,
      canNegotiate: true,
      canReserve: false,
      supportedSkus: ["BEEF_GROUND"],
      privateKey,
      products: [
        {
          sku: "BEEF_GROUND",
          name: "Ground beef",
          unit: "kg",
          unitPriceMicroUsdc: 1_800_000n,
          stockMilli: 10_000,
        },
      ],
    };

    const quote = await createSignedQuote(merchant, {
      taskId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      items: [{ sku: "BEEF_GROUND", quantityMilli: 500 }],
    });

    expect(quote.totalMicroUsdc).toBe("900000");
    expect(quote.items[0]?.available).toBe(true);
    expect(quote.recoveredSigner.toLowerCase()).toBe(
      account.address.toLowerCase(),
    );
  });
});
