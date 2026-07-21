import {
  encodeAbiParameters,
  keccak256,
  parseAbiParameters,
  recoverTypedDataAddress,
  type Address,
  type Hex,
} from "viem";
import type { QuoteItem } from "./schemas.js";

export const QUOTE_DOMAIN = {
  name: "Errand Merchant Quote",
  version: "1",
} as const;

export const QUOTE_TYPES = {
  Quote: [
    { name: "quoteId", type: "bytes32" },
    { name: "taskId", type: "bytes32" },
    { name: "merchantId", type: "bytes32" },
    { name: "merchantWallet", type: "address" },
    { name: "itemsHash", type: "bytes32" },
    { name: "totalMicroUsdc", type: "uint256" },
    { name: "validUntil", type: "uint256" },
    { name: "nonce", type: "bytes32" },
  ],
} as const;

const quoteItemParameters = parseAbiParameters(
  "(string sku,string name,uint256 quantityMilli,string unit,uint256 unitPriceMicroUsdc,uint256 totalPriceMicroUsdc,bool available)[] items",
);

export function hashQuoteItems(items: readonly QuoteItem[]): Hex {
  return keccak256(
    encodeAbiParameters(quoteItemParameters, [
      items.map((item) => ({
        ...item,
        quantityMilli: BigInt(item.quantityMilli),
        unitPriceMicroUsdc: BigInt(item.unitPriceMicroUsdc),
        totalPriceMicroUsdc: BigInt(item.totalPriceMicroUsdc),
      })),
    ]),
  );
}

export type QuoteTypedMessage = {
  quoteId: Hex;
  taskId: Hex;
  merchantId: Hex;
  merchantWallet: Address;
  itemsHash: Hex;
  totalMicroUsdc: bigint;
  validUntil: bigint;
  nonce: Hex;
};

export function quoteTypedData(chainId: number, message: QuoteTypedMessage) {
  return {
    domain: { ...QUOTE_DOMAIN, chainId },
    types: QUOTE_TYPES,
    primaryType: "Quote" as const,
    message,
  };
}

export async function recoverQuoteSigner(
  chainId: number,
  message: QuoteTypedMessage,
  signature: Hex,
): Promise<Address> {
  return recoverTypedDataAddress({
    ...quoteTypedData(chainId, message),
    signature,
  });
}
