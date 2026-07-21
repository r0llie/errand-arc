import {
  ARC_CHAIN,
  ARC_CHAIN_ID,
  ARC_EXPLORER_URL,
  ARC_RPC_URL,
  ARC_USDC_ADDRESS,
  ORDER_ESCROW_ABI,
  type DemoOrder,
  type DemoOrderStatus,
} from "@errand/shared";
import {
  createPublicClient,
  decodeEventLog,
  getAddress,
  http,
  isAddressEqual,
  type Address,
  type Hash,
} from "viem";
import { z } from "zod";

const AddressSchema = z.string().regex(/^0x[0-9a-fA-F]{40}$/);

export function getEscrowConfig() {
  const configured = process.env.ESCROW_CONTRACT_ADDRESS?.trim();
  return {
    enabled: Boolean(configured),
    chainId: ARC_CHAIN_ID,
    network: `eip155:${ARC_CHAIN_ID}` as const,
    rpcUrl: process.env.ARC_TESTNET_RPC_URL ?? ARC_RPC_URL,
    explorerUrl: ARC_EXPLORER_URL,
    usdcAddress: ARC_USDC_ADDRESS,
    contractAddress: configured
      ? getAddress(AddressSchema.parse(configured))
      : null,
  };
}

const statusByIndex: Record<number, DemoOrderStatus> = {
  1: "funded",
  2: "preparing",
  3: "ready",
  4: "completed",
  5: "refunded",
  6: "disputed",
};

export async function verifyEscrowTransaction(
  order: DemoOrder,
  transactionHash: Hash,
) {
  const config = getEscrowConfig();
  if (!config.contractAddress) throw new Error("Escrow is not deployed");
  const client = createPublicClient({
    chain: ARC_CHAIN,
    transport: http(config.rpcUrl),
  });
  const receipt = await client.getTransactionReceipt({ hash: transactionHash });
  if (receipt.status !== "success") throw new Error("Arc transaction reverted");
  if (!receipt.to || !isAddressEqual(receipt.to, config.contractAddress)) {
    throw new Error("Transaction did not target the configured escrow");
  }
  const statusByEvent: Record<string, DemoOrderStatus> = {
    OrderFunded: "funded",
    OrderPreparing: "preparing",
    OrderReady: "ready",
    OrderCompleted: "completed",
    OrderRefunded: "refunded",
    OrderDisputed: "disputed",
  };
  let emittedStatus: DemoOrderStatus | undefined;
  for (const log of receipt.logs) {
    if (!isAddressEqual(log.address, config.contractAddress)) continue;
    try {
      const decoded = decodeEventLog({
        abi: ORDER_ESCROW_ABI,
        data: log.data,
        topics: log.topics,
      });
      const matchesOrder =
        "orderId" in decoded.args &&
        decoded.args.orderId.toLowerCase() ===
          order.escrowReference.toLowerCase();
      if (matchesOrder) emittedStatus = statusByEvent[decoded.eventName];
    } catch {
      continue;
    }
  }
  if (!emittedStatus) {
    throw new Error("Transaction has no event for this order");
  }

  const [buyer, merchant, amount, , status] = await client.readContract({
    address: config.contractAddress,
    abi: ORDER_ESCROW_ABI,
    functionName: "orders",
    args: [order.escrowReference as Hash],
  });
  const mappedStatus = statusByIndex[Number(status)];
  if (!mappedStatus)
    throw new Error("Order is not funded on the configured escrow");
  if (mappedStatus !== emittedStatus) {
    throw new Error(
      "Transaction event is stale relative to the onchain order state",
    );
  }
  if (!isAddressEqual(merchant, order.merchantWallet as Address)) {
    throw new Error("Onchain merchant does not match the signed quote");
  }
  if (amount !== BigInt(order.totalMicroUsdc)) {
    throw new Error("Onchain escrow amount does not match the selected basket");
  }

  return {
    status: mappedStatus,
    buyerWallet: buyer,
    escrowContract: config.contractAddress,
    transactionHash,
  };
}
