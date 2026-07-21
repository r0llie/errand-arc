import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

const walletNames = [
  "AGENT",
  "MERCHANT_ALI",
  "MERCHANT_CAN",
  "MERCHANT_ZEYNEP",
  "MERCHANT_CEM",
  "MERCHANT_MARKET",
] as const;
const wallets = walletNames.map((name) => {
  const privateKey = generatePrivateKey();
  return { name, privateKey, address: privateKeyToAccount(privateKey).address };
});

const privateKey = (name: (typeof walletNames)[number]) =>
  wallets.find((wallet) => wallet.name === name)!.privateKey;

const env = `# Generated local demo environment. Never commit this file.
ARC_TESTNET_RPC_URL=https://rpc.testnet.arc.network
ARC_CHAIN_ID=5042002
ARC_USDC_ADDRESS=0x3600000000000000000000000000000000000000
ARC_EXPLORER_URL=https://testnet.arcscan.app

AGENT_WALLET_PRIVATE_KEY=${privateKey("AGENT")}
MERCHANT_ALI_PRIVATE_KEY=${privateKey("MERCHANT_ALI")}
MERCHANT_CAN_PRIVATE_KEY=${privateKey("MERCHANT_CAN")}
MERCHANT_ZEYNEP_PRIVATE_KEY=${privateKey("MERCHANT_ZEYNEP")}
MERCHANT_CEM_PRIVATE_KEY=${privateKey("MERCHANT_CEM")}
MERCHANT_MARKET_PRIVATE_KEY=${privateKey("MERCHANT_MARKET")}

NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=
SUPABASE_SERVICE_ROLE_KEY=
ANTHROPIC_API_KEY=
AI_MODEL=claude-sonnet-4-6

DEMO_MODE=true
NEXT_PUBLIC_APP_URL=http://localhost:3000
NEXT_PUBLIC_AGENT_URL=http://localhost:3001
MERCHANT_API_URL=http://localhost:4000
AGENT_PORT=3001
MERCHANT_API_PORT=4000
NEXT_PUBLIC_PRIVY_APP_ID=
ESCROW_CONTRACT_ADDRESS=
DEPLOYER_PRIVATE_KEY=
`;

const outputPath = resolve(".env.local");
await writeFile(outputPath, env, { encoding: "utf8", flag: "wx", mode: 0o600 });

console.log(
  `Created ${outputPath}. Private keys were written only to that ignored file.`,
);
for (const wallet of wallets) console.log(`${wallet.name}: ${wallet.address}`);
