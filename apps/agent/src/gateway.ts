import { GatewayClient } from "@circle-fin/x402-batching/client";
import { z } from "zod";

let client: GatewayClient | undefined;

export function getGatewayClient(): GatewayClient {
  if (client) return client;
  const privateKey = z
    .string()
    .regex(/^0x[0-9a-fA-F]{64}$/)
    .parse(process.env.AGENT_WALLET_PRIVATE_KEY) as `0x${string}`;
  const rpcUrl = z
    .string()
    .url()
    .optional()
    .parse(process.env.ARC_TESTNET_RPC_URL);

  client = new GatewayClient({ chain: "arcTestnet", privateKey, rpcUrl });
  return client;
}
