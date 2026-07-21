import { afterEach, describe, expect, it } from "vitest";
import { assertResearchBalance, isDemoMode } from "./payments.js";

const originalDemoMode = process.env.DEMO_MODE;

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
});
