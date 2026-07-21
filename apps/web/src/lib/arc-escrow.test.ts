import { describe, expect, it } from "vitest";
import {
  computeDeliveryCodeHash,
  formatPickupProof,
  parsePickupProof,
} from "./arc-escrow";

const salt = `0x${"22".repeat(32)}` as const;

describe("Arc escrow pickup proof", () => {
  it("encodes and parses the shopper proof without losing the salt", () => {
    const encoded = formatPickupProof({
      pickupCode: "123456",
      deliveryCodeSalt: salt,
    });
    expect(parsePickupProof(encoded)).toEqual({ code: "123456", salt });
  });

  it("rejects incomplete or malformed proofs", () => {
    expect(() => parsePickupProof("123456")).toThrow("complete pickup proof");
    expect(() => parsePickupProof(`12345:${salt}`)).toThrow(
      "complete pickup proof",
    );
  });

  it("commits the code to the Arc chain, contract, order, and salt", () => {
    const hash = computeDeliveryCodeHash(
      {
        escrowReference: `0x${"11".repeat(32)}`,
        pickupCode: "123456",
        deliveryCodeSalt: salt,
      },
      "0x3333333333333333333333333333333333333333",
    );
    expect(hash).toMatch(/^0x[0-9a-f]{64}$/);
    expect(
      computeDeliveryCodeHash(
        {
          escrowReference: `0x${"11".repeat(32)}`,
          pickupCode: "654321",
          deliveryCodeSalt: salt,
        },
        "0x3333333333333333333333333333333333333333",
      ),
    ).not.toBe(hash);
  });
});
