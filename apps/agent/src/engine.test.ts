import { describe, expect, it } from "vitest";
import { parseShoppingIntent } from "./engine.js";

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
});
