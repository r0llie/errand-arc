import { GatewayClient } from "@circle-fin/x402-batching/client";
import { z } from "zod";

let client: GatewayClient | undefined;

export function getGatewayClient(): GatewayClient {
  if (client) return client;
  const privateKey = z
    .string()
    .regex(/^0x[0-9a-fA-F]{64}$/)
    .parse(process.env.AGENT_WALLET_PRIVATE_KEY) as `0x${string}`;

  client = new GatewayClient({ chain: "arcTestnet", privateKey });
  return client;
}
