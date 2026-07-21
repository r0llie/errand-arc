import { arcTestnet } from "viem/chains";
import { keccak256, toBytes } from "viem";

export const ARC_CHAIN = arcTestnet;
export const ARC_CHAIN_ID = 5_042_002 as const;
export const ARC_RPC_URL = "https://rpc.drpc.testnet.arc.network" as const;
export const ARC_EXPLORER_URL = "https://testnet.arcscan.app" as const;
export const ARC_USDC_ADDRESS =
  "0x3600000000000000000000000000000000000000" as const;
export const ARC_GATEWAY_WALLET =
  "0x0077777d7EBA4688BDeF3E311b846F25870A19B9" as const;
export const ARC_GATEWAY_DOMAIN = 26 as const;
export const ERRAND_PICKUP_DOMAIN = keccak256(toBytes("ERRAND_PICKUP_V1"));

export const ARC_USDC_ABI = [
  {
    type: "function",
    name: "approve",
    stateMutability: "nonpayable",
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    type: "function",
    name: "allowance",
    stateMutability: "view",
    inputs: [
      { name: "owner", type: "address" },
      { name: "spender", type: "address" },
    ],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "transfer",
    stateMutability: "nonpayable",
    inputs: [
      { name: "to", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
] as const;

export const ORDER_ESCROW_ABI = [
  {
    type: "function",
    name: "fund",
    stateMutability: "nonpayable",
    inputs: [
      { name: "orderId", type: "bytes32" },
      { name: "merchant", type: "address" },
      { name: "amount", type: "uint256" },
      { name: "deliveryCodeHash", type: "bytes32" },
      { name: "pickupDeadline", type: "uint256" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "markPreparing",
    stateMutability: "nonpayable",
    inputs: [{ name: "orderId", type: "bytes32" }],
    outputs: [],
  },
  {
    type: "function",
    name: "markReady",
    stateMutability: "nonpayable",
    inputs: [{ name: "orderId", type: "bytes32" }],
    outputs: [],
  },
  {
    type: "function",
    name: "confirmPickup",
    stateMutability: "nonpayable",
    inputs: [
      { name: "orderId", type: "bytes32" },
      { name: "deliveryCode", type: "string" },
      { name: "salt", type: "bytes32" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "orders",
    stateMutability: "view",
    inputs: [{ name: "orderId", type: "bytes32" }],
    outputs: [
      { name: "buyer", type: "address" },
      { name: "merchant", type: "address" },
      { name: "amount", type: "uint128" },
      { name: "pickupDeadline", type: "uint64" },
      { name: "status", type: "uint8" },
      { name: "deliveryCodeHash", type: "bytes32" },
    ],
  },
  {
    type: "event",
    name: "OrderFunded",
    inputs: [
      { name: "orderId", type: "bytes32", indexed: true },
      { name: "buyer", type: "address", indexed: true },
      { name: "merchant", type: "address", indexed: true },
      { name: "amount", type: "uint256", indexed: false },
      { name: "pickupDeadline", type: "uint256", indexed: false },
    ],
  },
  {
    type: "event",
    name: "OrderPreparing",
    inputs: [{ name: "orderId", type: "bytes32", indexed: true }],
  },
  {
    type: "event",
    name: "OrderReady",
    inputs: [{ name: "orderId", type: "bytes32", indexed: true }],
  },
  {
    type: "event",
    name: "OrderCompleted",
    inputs: [
      { name: "orderId", type: "bytes32", indexed: true },
      { name: "amount", type: "uint256", indexed: false },
    ],
  },
  {
    type: "event",
    name: "OrderRefunded",
    inputs: [
      { name: "orderId", type: "bytes32", indexed: true },
      { name: "amount", type: "uint256", indexed: false },
      { name: "reason", type: "string", indexed: false },
    ],
  },
  {
    type: "event",
    name: "OrderDisputed",
    inputs: [
      { name: "orderId", type: "bytes32", indexed: true },
      { name: "raisedBy", type: "address", indexed: true },
    ],
  },
] as const;
