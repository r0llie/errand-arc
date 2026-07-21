import hardhatNodeTestRunner from "@nomicfoundation/hardhat-node-test-runner";
import hardhatViem from "@nomicfoundation/hardhat-viem";
import { config as loadEnv } from "dotenv";
import { configVariable, defineConfig } from "hardhat/config";

loadEnv({ path: "../../.env.local", quiet: true });

export default defineConfig({
  plugins: [hardhatViem, hardhatNodeTestRunner],
  solidity: {
    version: "0.8.28",
    settings: {
      optimizer: { enabled: true, runs: 200 },
    },
  },
  networks: {
    arcTestnet: {
      type: "http",
      chainType: "l1",
      chainId: 5_042_002,
      url: configVariable("ARC_TESTNET_RPC_URL"),
      accounts: [configVariable("AGENT_WALLET_PRIVATE_KEY")],
    },
  },
});
