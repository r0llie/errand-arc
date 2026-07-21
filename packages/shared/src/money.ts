import { formatUnits, parseUnits } from "viem";
import { z } from "zod";

export const USDC_DECIMALS = 6 as const;
export const MicroUsdcStringSchema = z.string().regex(/^\d+$/);

export function parseUsdc(value: string): bigint {
  return parseUnits(value, USDC_DECIMALS);
}

export function parseMicroUsdc(value: string): bigint {
  return BigInt(MicroUsdcStringSchema.parse(value));
}

export function formatUsdc(value: bigint): string {
  return formatUnits(value, USDC_DECIMALS);
}

export function toMicroUsdcString(value: bigint): string {
  if (value < 0n) throw new RangeError("USDC amount cannot be negative");
  return value.toString();
}

export const MICROPAYMENT_COSTS = {
  inventory: parseUsdc("0.0003"),
  quote: parseUsdc("0.0005"),
  negotiate: parseUsdc("0.002"),
  reserve: parseUsdc("0.001"),
} as const;

export const RESEARCH_POLICY = {
  taskCap: parseUsdc("0.01"),
  requestCap: parseUsdc("0.002"),
  minimumAgentReserve: parseUsdc("0.025"),
  maxQuoteMerchants: 8,
  quoteTtlSeconds: 300,
} as const;
