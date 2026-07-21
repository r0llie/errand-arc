import {
  ARC_CHAIN,
  ARC_CHAIN_ID,
  ARC_EXPLORER_URL,
  ARC_RPC_URL,
  ARC_USDC_ABI,
  ARC_USDC_ADDRESS,
  ERRAND_PICKUP_DOMAIN,
  ORDER_ESCROW_ABI,
  type DemoOrder,
  type MerchantOrder,
} from "@errand/shared";
import {
  createPublicClient,
  createWalletClient,
  custom,
  encodeAbiParameters,
  http,
  isAddressEqual,
  keccak256,
  parseAbiParameters,
  toBytes,
  type Address,
  type EIP1193Provider,
  type Hash,
} from "viem";

export type EscrowConfig = {
  enabled: boolean;
  chainId: typeof ARC_CHAIN_ID;
  network: `eip155:${typeof ARC_CHAIN_ID}`;
  rpcUrl: string;
  explorerUrl: string;
  usdcAddress: Address;
  contractAddress: Address | null;
};

type ArcWalletSession = Awaited<ReturnType<typeof connectArcWallet>>;

function injectedProvider(): EIP1193Provider {
  const provider = (window as Window & { ethereum?: EIP1193Provider }).ethereum;
  if (!provider) throw new Error("Install or open an EVM wallet to continue");
  return provider;
}

export async function connectArcWallet() {
  const provider = injectedProvider();
  try {
    await provider.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: `0x${ARC_CHAIN_ID.toString(16)}` }],
    });
  } catch (cause) {
    const code = (cause as { code?: number }).code;
    if (code !== 4902) throw cause;
    await provider.request({
      method: "wallet_addEthereumChain",
      params: [
        {
          chainId: `0x${ARC_CHAIN_ID.toString(16)}`,
          chainName: "Arc Testnet",
          nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
          rpcUrls: [ARC_RPC_URL],
          blockExplorerUrls: [ARC_EXPLORER_URL],
        },
      ],
    });
  }
  const walletClient = createWalletClient({
    chain: ARC_CHAIN,
    transport: custom(provider),
  });
  const [account] = await walletClient.requestAddresses();
  if (!account) throw new Error("Wallet connection was not approved");
  const publicClient = createPublicClient({
    chain: ARC_CHAIN,
    transport: http(ARC_RPC_URL),
  });
  return { account, walletClient, publicClient };
}

export function computeDeliveryCodeHash(
  order: Pick<DemoOrder, "escrowReference"> & {
    pickupCode: string;
    deliveryCodeSalt: string;
  },
  escrowContract: Address,
) {
  return keccak256(
    encodeAbiParameters(
      parseAbiParameters(
        "bytes32 domain, uint256 chainId, address escrow, bytes32 orderId, bytes32 codeHash, bytes32 salt",
      ),
      [
        ERRAND_PICKUP_DOMAIN,
        BigInt(ARC_CHAIN_ID),
        escrowContract,
        order.escrowReference as Hash,
        keccak256(toBytes(order.pickupCode)),
        order.deliveryCodeSalt as Hash,
      ],
    ),
  );
}

export async function fundEscrowOrder(
  session: ArcWalletSession,
  config: EscrowConfig,
  order: DemoOrder,
) {
  if (!config.contractAddress) throw new Error("Escrow is not deployed yet");
  if (order.paymentMode !== "arc_testnet") {
    throw new Error("Demo orders do not submit wallet transactions");
  }
  if (!order.pickupCode || !order.deliveryCodeSalt) {
    throw new Error("Shopper pickup proof is missing");
  }
  if (isAddressEqual(session.account, order.merchantWallet as Address)) {
    throw new Error("Buyer and merchant wallets must be different");
  }
  const amount = BigInt(order.totalMicroUsdc);
  const balance = await session.publicClient.readContract({
    address: ARC_USDC_ADDRESS,
    abi: ARC_USDC_ABI,
    functionName: "balanceOf",
    args: [session.account],
  });
  if (balance < amount)
    throw new Error("Wallet has insufficient Arc Testnet USDC");
  const allowance = await session.publicClient.readContract({
    address: ARC_USDC_ADDRESS,
    abi: ARC_USDC_ABI,
    functionName: "allowance",
    args: [session.account, config.contractAddress],
  });
  let approvalHash: Hash | undefined;
  if (allowance < amount) {
    const approval = await session.publicClient.simulateContract({
      account: session.account,
      address: ARC_USDC_ADDRESS,
      abi: ARC_USDC_ABI,
      functionName: "approve",
      args: [config.contractAddress, amount],
    });
    approvalHash = await session.walletClient.writeContract(approval.request);
    const receipt = await session.publicClient.waitForTransactionReceipt({
      hash: approvalHash,
    });
    if (receipt.status !== "success") throw new Error("USDC approval reverted");
  }
  const funding = await session.publicClient.simulateContract({
    account: session.account,
    address: config.contractAddress,
    abi: ORDER_ESCROW_ABI,
    functionName: "fund",
    args: [
      order.escrowReference as Hash,
      order.merchantWallet as Address,
      amount,
      computeDeliveryCodeHash(
        {
          escrowReference: order.escrowReference,
          pickupCode: order.pickupCode,
          deliveryCodeSalt: order.deliveryCodeSalt,
        },
        config.contractAddress,
      ),
      BigInt(order.pickupDeadline),
    ],
  });
  const transactionHash = await session.walletClient.writeContract(
    funding.request,
  );
  const receipt = await session.publicClient.waitForTransactionReceipt({
    hash: transactionHash,
  });
  if (receipt.status !== "success") throw new Error("Escrow funding reverted");
  return { approvalHash, transactionHash };
}

export async function advanceEscrowOrder(
  session: ArcWalletSession,
  config: EscrowConfig,
  order: MerchantOrder,
  pickupProof?: string,
) {
  if (!config.contractAddress) throw new Error("Escrow is not deployed yet");
  if (!isAddressEqual(session.account, order.merchantWallet as Address)) {
    throw new Error(`Connect the ${order.merchantName} merchant wallet`);
  }
  let functionName: "markPreparing" | "markReady" | "confirmPickup";
  let args: readonly [Hash] | readonly [Hash, string, Hash];
  if (order.status === "funded") {
    functionName = "markPreparing";
    args = [order.escrowReference as Hash];
  } else if (order.status === "preparing") {
    functionName = "markReady";
    args = [order.escrowReference as Hash];
  } else if (order.status === "ready") {
    const proof = parsePickupProof(pickupProof ?? "");
    functionName = "confirmPickup";
    args = [order.escrowReference as Hash, proof.code, proof.salt];
  } else {
    throw new Error(`Order cannot advance from ${order.status}`);
  }
  const simulation = await session.publicClient.simulateContract({
    account: session.account,
    address: config.contractAddress,
    abi: ORDER_ESCROW_ABI,
    functionName,
    args,
  });
  const transactionHash = await session.walletClient.writeContract(
    simulation.request,
  );
  const receipt = await session.publicClient.waitForTransactionReceipt({
    hash: transactionHash,
  });
  if (receipt.status !== "success") throw new Error("Escrow update reverted");
  return transactionHash;
}

export function formatPickupProof(order: {
  pickupCode?: string;
  deliveryCodeSalt?: string;
}) {
  if (!order.pickupCode || !order.deliveryCodeSalt) {
    throw new Error("Shopper pickup proof is missing");
  }
  return `${order.pickupCode}:${order.deliveryCodeSalt}`;
}

export function parsePickupProof(value: string): { code: string; salt: Hash } {
  const [code, salt, extra] = value.trim().split(":");
  if (extra || !code?.match(/^\d{6}$/) || !salt?.match(/^0x[0-9a-fA-F]{64}$/)) {
    throw new Error("Paste the complete pickup proof from the shopper");
  }
  return { code, salt: salt as Hash };
}
