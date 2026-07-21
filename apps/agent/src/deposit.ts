import { config } from "dotenv";
import { z } from "zod";
import { getGatewayClient } from "./gateway.js";

config({ path: new URL("../../../.env.local", import.meta.url) });

const amount = z
  .string()
  .regex(
    /^\d+(\.\d{1,6})?$/,
    "Use a positive USDC amount with at most 6 decimals",
  )
  .refine((value) => Number(value) > 0, "Amount must be greater than zero")
  .parse(process.argv[2]);

const gateway = getGatewayClient();
const before = await gateway.getBalances();
console.log(
  `Depositing ${amount} USDC from ${gateway.address} to Circle Gateway on Arc Testnet...`,
);

const result = await gateway.deposit(amount);
const after = await gateway.getBalances();

console.log({
  approvalTxHash: result.approvalTxHash,
  depositTxHash: result.depositTxHash,
  depositedUsdc: result.formattedAmount,
  gatewayAvailableBefore: before.gateway.formattedAvailable,
  gatewayAvailableAfter: after.gateway.formattedAvailable,
});
