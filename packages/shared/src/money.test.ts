import { describe, expect, it } from "vitest";
import { formatUsdc, parseUsdc, toMicroUsdcString } from "./money.js";

describe("USDC helpers", () => {
  it("keeps USDC in six-decimal integer units", () => {
    expect(parseUsdc("1.000001")).toBe(1_000_001n);
    expect(formatUsdc(1_000_001n)).toBe("1.000001");
    expect(toMicroUsdcString(1_000_001n)).toBe("1000001");
  });

  it("rejects negative API amounts", () => {
    expect(() => toMicroUsdcString(-1n)).toThrow(RangeError);
  });
});
