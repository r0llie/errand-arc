import { config } from "dotenv";
import {
  ARC_CHAIN,
  ARC_CHAIN_ID,
  ARC_RPC_URL,
  ARC_USDC_ABI,
  ARC_USDC_ADDRESS,
  ERRAND_PICKUP_DOMAIN,
  ORDER_ESCROW_ABI,
} from "@errand/shared";
import {
  createPublicClient,
  createWalletClient,
  encodeAbiParameters,
  formatUnits,
  http,
  isAddressEqual,
  keccak256,
  parseAbiParameters,
  parseUnits,
  toBytes,
  type Hash,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

config({ path: "../../.env.local", quiet: true });

function requiredPrivateKey(name: string): `0x${string}` {
  const value = process.env[name];
  if (!value || !/^0x[0-9a-fA-F]{64}$/.test(value)) {
    throw new Error(`${name} must be a 32-byte hex private key`);
  }
  return value as `0x${string}`;
}

function requiredAddress(name: string): `0x${string}` {
  const value = process.env[name];
  if (!value || !/^0x[0-9a-fA-F]{40}$/.test(value)) {
    throw new Error(`${name} must be an EVM address`);
  }
  return value as `0x${string}`;
}

const execute = process.argv.includes("--execute");
const escrowAddress = requiredAddress("ESCROW_CONTRACT_ADDRESS");
const buyer = privateKeyToAccount(
  requiredPrivateKey("AGENT_WALLET_PRIVATE_KEY"),
);
const merchant = privateKeyToAccount(
  requiredPrivateKey("MERCHANT_CAN_PRIVATE_KEY"),
);
const expectedMerchant = "0xD26b8449EEC09e4193c3A3Be2140Fd5F4DBa0E6b";
if (!isAddressEqual(merchant.address, expectedMerchant)) {
  throw new Error("Can Butcher key does not match the approved merchant");
}

const rpcUrl = process.env.ARC_TESTNET_RPC_URL ?? ARC_RPC_URL;
const publicClient = createPublicClient({
  chain: ARC_CHAIN,
  transport: http(rpcUrl),
});
const buyerClient = createWalletClient({
  account: buyer,
  chain: ARC_CHAIN,
  transport: http(rpcUrl),
});
const merchantClient = createWalletClient({
  account: merchant,
  chain: ARC_CHAIN,
  transport: http(rpcUrl),
});

const chainId = await publicClient.getChainId();
if (chainId !== ARC_CHAIN_ID)
  throw new Error(`Refusing unexpected chain ${chainId}`);
const bytecode = await publicClient.getCode({ address: escrowAddress });
if (!bytecode || bytecode === "0x")
  throw new Error("Escrow bytecode is missing");

const orderId = keccak256(toBytes("ERRAND_LIVE_DEMO_CAN_V1"));
const existing = await publicClient.readContract({
  address: escrowAddress,
  abi: ORDER_ESCROW_ABI,
  functionName: "orders",
  args: [orderId],
});
if (Number(existing[4]) !== 0) {
  throw new Error(
    `Refusing duplicate lifecycle: order status is ${existing[4]}`,
  );
}

const amount = parseUnits("1.5", 6);
const gasLimits = {
  approve: 100_000n,
  fund: 250_000n,
  preparing: 100_000n,
  ready: 100_000n,
  pickup: 200_000n,
} as const;
const totalGasLimit = Object.values(gasLimits).reduce(
  (total, value) => total + value,
  0n,
);
const gasPrice = await publicClient.getGasPrice();
const maximumGasCost = totalGasLimit * gasPrice;
const approvedGasCap = parseUnits("0.02", 18);
if (maximumGasCost > approvedGasCap) {
  throw new Error(
    `Lifecycle maximum ${formatUnits(maximumGasCost, 18)} USDC exceeds 0.02 USDC proposal`,
  );
}

const [buyerBalance, merchantBalance, allowance] = await Promise.all([
  publicClient.readContract({
    address: ARC_USDC_ADDRESS,
    abi: ARC_USDC_ABI,
    functionName: "balanceOf",
    args: [buyer.address],
  }),
  publicClient.readContract({
    address: ARC_USDC_ADDRESS,
    abi: ARC_USDC_ABI,
    functionName: "balanceOf",
    args: [merchant.address],
  }),
  publicClient.readContract({
    address: ARC_USDC_ADDRESS,
    abi: ARC_USDC_ABI,
    functionName: "allowance",
    args: [buyer.address, escrowAddress],
  }),
]);
const maximumGasMicroUsdc =
  (maximumGasCost + 999_999_999_999n) / 1_000_000_000_000n;
if (buyerBalance < amount + maximumGasMicroUsdc) {
  throw new Error("Buyer lacks USDC for the principal and bounded gas");
}
if (
  merchantBalance <
  ((gasLimits.preparing + gasLimits.ready + gasLimits.pickup) * gasPrice) /
    1_000_000_000_000n
) {
  throw new Error("Merchant lacks USDC for lifecycle gas");
}

const plan = {
  execute,
  chainId,
  contract: escrowAddress,
  orderId,
  buyer: buyer.address,
  merchant: merchant.address,
  amountUsdc: "1.5",
  buyerBalanceUsdc: formatUnits(buyerBalance, 6),
  merchantBalanceUsdc: formatUnits(merchantBalance, 6),
  currentAllowanceUsdc: formatUnits(allowance, 6),
  maximumGasCostUsdc: formatUnits(maximumGasCost, 18),
  hardGasCapUsdc: "0.02",
};
if (!execute) {
  console.log(JSON.stringify(plan));
  process.exit(0);
}

const randomNumber = crypto.getRandomValues(new Uint32Array(1))[0]!;
const pickupCode = String(100_000 + (randomNumber % 900_000));
const salt = `0x${Array.from(
  crypto.getRandomValues(new Uint8Array(32)),
  (byte) => byte.toString(16).padStart(2, "0"),
).join("")}` as Hash;
const pickupDeadline = BigInt(Math.floor(Date.now() / 1_000) + 24 * 60 * 60);
const deliveryCodeHash = keccak256(
  encodeAbiParameters(
    parseAbiParameters(
      "bytes32 domain, uint256 chainId, address escrow, bytes32 orderId, bytes32 codeHash, bytes32 salt",
    ),
    [
      ERRAND_PICKUP_DOMAIN,
      BigInt(ARC_CHAIN_ID),
      escrowAddress,
      orderId,
      keccak256(toBytes(pickupCode)),
      salt,
    ],
  ),
);

const transactionHashes: Record<string, Hash> = {};
if (allowance < amount) {
  await publicClient.simulateContract({
    account: buyer,
    address: ARC_USDC_ADDRESS,
    abi: ARC_USDC_ABI,
    functionName: "approve",
    args: [escrowAddress, amount],
  });
  const approvalHash = await buyerClient.writeContract({
    account: buyer,
    chain: ARC_CHAIN,
    address: ARC_USDC_ADDRESS,
    abi: ARC_USDC_ABI,
    functionName: "approve",
    args: [escrowAddress, amount],
    gas: gasLimits.approve,
    gasPrice,
  });
  transactionHashes.approve = approvalHash;
  const receipt = await publicClient.waitForTransactionReceipt({
    hash: approvalHash,
  });
  if (receipt.status !== "success") throw new Error("USDC approval reverted");
}

await publicClient.simulateContract({
  account: buyer,
  address: escrowAddress,
  abi: ORDER_ESCROW_ABI,
  functionName: "fund",
  args: [orderId, merchant.address, amount, deliveryCodeHash, pickupDeadline],
});
const fundingHash = await buyerClient.writeContract({
  account: buyer,
  chain: ARC_CHAIN,
  address: escrowAddress,
  abi: ORDER_ESCROW_ABI,
  functionName: "fund",
  args: [orderId, merchant.address, amount, deliveryCodeHash, pickupDeadline],
  gas: gasLimits.fund,
  gasPrice,
});
transactionHashes.fund = fundingHash;
let receipt = await publicClient.waitForTransactionReceipt({
  hash: fundingHash,
});
if (receipt.status !== "success") throw new Error("Escrow funding reverted");

await publicClient.simulateContract({
  account: merchant,
  address: escrowAddress,
  abi: ORDER_ESCROW_ABI,
  functionName: "markPreparing",
  args: [orderId],
});
const preparingHash = await merchantClient.writeContract({
  account: merchant,
  chain: ARC_CHAIN,
  address: escrowAddress,
  abi: ORDER_ESCROW_ABI,
  functionName: "markPreparing",
  args: [orderId],
  gas: gasLimits.preparing,
  gasPrice,
});
transactionHashes.preparing = preparingHash;
receipt = await publicClient.waitForTransactionReceipt({ hash: preparingHash });
if (receipt.status !== "success") throw new Error("preparing reverted");

await publicClient.simulateContract({
  account: merchant,
  address: escrowAddress,
  abi: ORDER_ESCROW_ABI,
  functionName: "markReady",
  args: [orderId],
});
const readyHash = await merchantClient.writeContract({
  account: merchant,
  chain: ARC_CHAIN,
  address: escrowAddress,
  abi: ORDER_ESCROW_ABI,
  functionName: "markReady",
  args: [orderId],
  gas: gasLimits.ready,
  gasPrice,
});
transactionHashes.ready = readyHash;
receipt = await publicClient.waitForTransactionReceipt({ hash: readyHash });
if (receipt.status !== "success") throw new Error("ready reverted");

await publicClient.simulateContract({
  account: merchant,
  address: escrowAddress,
  abi: ORDER_ESCROW_ABI,
  functionName: "confirmPickup",
  args: [orderId, pickupCode, salt],
});
const pickupHash = await merchantClient.writeContract({
  account: merchant,
  chain: ARC_CHAIN,
  address: escrowAddress,
  abi: ORDER_ESCROW_ABI,
  functionName: "confirmPickup",
  args: [orderId, pickupCode, salt],
  gas: gasLimits.pickup,
  gasPrice,
});
transactionHashes.pickup = pickupHash;
receipt = await publicClient.waitForTransactionReceipt({
  hash: pickupHash,
});
if (receipt.status !== "success") throw new Error("Pickup release reverted");

const finalOrder = await publicClient.readContract({
  address: escrowAddress,
  abi: ORDER_ESCROW_ABI,
  functionName: "orders",
  args: [orderId],
});
if (Number(finalOrder[4]) !== 4) {
  throw new Error(`Expected completed status, received ${finalOrder[4]}`);
}

console.log(
  JSON.stringify({
    ...plan,
    status: "completed",
    transactionHashes,
  }),
);
