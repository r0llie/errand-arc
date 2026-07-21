import { stringToHex, type Hex } from "viem";

export function uuidToBytes32(uuid: string): Hex {
  const normalized = uuid.replaceAll("-", "");
  if (!/^[0-9a-fA-F]{32}$/.test(normalized)) {
    throw new TypeError(`Invalid UUID: ${uuid}`);
  }
  return `0x${normalized.padEnd(64, "0")}` as Hex;
}

export function slugToBytes32(slug: string): Hex {
  return stringToHex(slug, { size: 32 });
}
