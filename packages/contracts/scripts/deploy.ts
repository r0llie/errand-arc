import { network } from "hardhat";
import { formatUnits, getAddress, isAddressEqual, parseUnits } from "viem";

if (process.env.ESCROW_CONTRACT_ADDRESS?.trim()) {
  throw new Error(
    `Refusing to redeploy: ESCROW_CONTRACT_ADDRESS is already configured`,
  );
}

const { viem } = await network.getOrCreate("arcTestnet");
const [deployer] = await viem.getWalletClients();
const publicClient = await viem.getPublicClient();

if (!deployer) throw new Error("Arc deployer wallet is not configured");

const usdcAddress = "0x3600000000000000000000000000000000000000";
const chainId = await publicClient.getChainId();
if (chainId !== 5_042_002)
  throw new Error(`Refusing unexpected chain ${chainId}`);

const gasLimit = 1_250_000n;
const gasPrice = await publicClient.getGasPrice();
const approvedMaximumGasCost = parseUnits("0.03", 18);
const maximumGasCost = gasLimit * gasPrice;
if (maximumGasCost > approvedMaximumGasCost) {
  throw new Error(
    `Deployment maximum ${formatUnits(maximumGasCost, 18)} USDC exceeds approved 0.03 USDC cap`,
  );
}

const { contract: escrow, deploymentTransaction } =
  await viem.sendDeploymentTransaction(
    "OrderEscrow",
    [usdcAddress, deployer.account.address],
    { gas: gasLimit, gasPrice },
  );
const deploymentTransactionHash = deploymentTransaction.hash;
const receipt = await publicClient.waitForTransactionReceipt({
  hash: deploymentTransactionHash,
});
if (receipt.status !== "success" || !receipt.contractAddress) {
  throw new Error("OrderEscrow deployment reverted");
}
if (!isAddressEqual(receipt.contractAddress, escrow.address)) {
  throw new Error("Deployment receipt returned an unexpected contract address");
}
const configuredUsdc = await escrow.read.usdc();
const configuredOwner = await escrow.read.owner();
if (!isAddressEqual(configuredUsdc, getAddress(usdcAddress))) {
  throw new Error("Deployed escrow has an unexpected USDC token");
}
if (!isAddressEqual(configuredOwner, deployer.account.address)) {
  throw new Error("Deployed escrow has an unexpected owner");
}

console.log(
  JSON.stringify({
    chainId,
    deployer: deployer.account.address,
    usdc: usdcAddress,
    orderEscrow: escrow.address,
    transactionHash: deploymentTransactionHash,
    gasUsed: receipt.gasUsed.toString(),
    effectiveGasPrice: receipt.effectiveGasPrice.toString(),
    actualGasCostUsdc: formatUnits(
      receipt.gasUsed * receipt.effectiveGasPrice,
      18,
    ),
    approvedMaximumGasCostUsdc: "0.03",
  }),
);
