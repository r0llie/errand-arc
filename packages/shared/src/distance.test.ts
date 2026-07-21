import { describe, expect, it } from "vitest";
import { haversineMeters, walkingMinutes } from "./distance.js";

describe("distance helpers", () => {
  it("returns zero for the same point", () => {
    expect(haversineMeters(39.9208, 32.8541, 39.9208, 32.8541)).toBe(0);
  });

  it("converts meters to conservative walking minutes", () => {
    expect(walkingMinutes(0)).toBe(1);
    expect(walkingMinutes(160)).toBe(2);
  });
});
