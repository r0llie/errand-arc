import { config } from "dotenv";
import { z } from "zod";
import {
  ARC_CHAIN,
  ARC_CHAIN_ID,
  ARC_RPC_URL,
  ARC_USDC_ABI,
  ARC_USDC_ADDRESS,
} from "@errand/shared";
import {
  createPublicClient,
  createWalletClient,
  formatUnits,
  http,
  isAddressEqual,
  parseUnits,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

config({ path: new URL("../../../.env.local", import.meta.url), quiet: true });

const PrivateKeySchema = z.string().regex(/^0x[0-9a-fA-F]{64}$/);
const expectedRecipient = "0xD26b8449EEC09e4193c3A3Be2140Fd5F4DBa0E6b";
const amount = parseUnits("0.1", 6);
const sender = privateKeyToAccount(
  PrivateKeySchema.parse(process.env.AGENT_WALLET_PRIVATE_KEY) as `0x${string}`,
);
const recipient = privateKeyToAccount(
  PrivateKeySchema.parse(process.env.MERCHANT_CAN_PRIVATE_KEY) as `0x${string}`,
);
if (!isAddressEqual(recipient.address, expectedRecipient)) {
  throw new Error("Can Butcher key does not match the approved recipient");
}

const rpcUrl = process.env.ARC_TESTNET_RPC_URL ?? ARC_RPC_URL;
const publicClient = createPublicClient({
  chain: ARC_CHAIN,
  transport: http(rpcUrl),
});
const walletClient = createWalletClient({
  account: sender,
  chain: ARC_CHAIN,
  transport: http(rpcUrl),
});
const chainId = await publicClient.getChainId();
if (chainId !== ARC_CHAIN_ID)
  throw new Error(`Refusing unexpected chain ${chainId}`);

const before = await publicClient.readContract({
  address: ARC_USDC_ADDRESS,
  abi: ARC_USDC_ABI,
  functionName: "balanceOf",
  args: [recipient.address],
});
if (before !== 0n) {
  throw new Error(
    `Refusing duplicate top-up: Can Butcher already has ${formatUnits(before, 6)} USDC`,
  );
}
const simulation = await publicClient.simulateContract({
  account: sender,
  address: ARC_USDC_ADDRESS,
  abi: ARC_USDC_ABI,
  functionName: "transfer",
  args: [recipient.address, amount],
});
const transactionHash = await walletClient.writeContract(simulation.request);
const receipt = await publicClient.waitForTransactionReceipt({
  hash: transactionHash,
});
if (receipt.status !== "success") throw new Error("Merchant top-up reverted");
const after = await publicClient.readContract({
  address: ARC_USDC_ADDRESS,
  abi: ARC_USDC_ABI,
  functionName: "balanceOf",
  args: [recipient.address],
});
if (after - before !== amount) {
  throw new Error("Merchant balance did not increase by exactly 0.1 USDC");
}

console.log(
  JSON.stringify({
    chainId,
    token: ARC_USDC_ADDRESS,
    sender: sender.address,
    recipient: recipient.address,
    amountUsdc: "0.1",
    balanceBeforeUsdc: formatUnits(before, 6),
    balanceAfterUsdc: formatUnits(after, 6),
    transactionHash,
  }),
);
