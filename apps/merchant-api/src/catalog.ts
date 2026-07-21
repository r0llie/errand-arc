import { privateKeyToAccount } from "viem/accounts";
import { z } from "zod";
import type { Merchant, Sku } from "@errand/shared";

const PrivateKeySchema = z.string().regex(/^0x[0-9a-fA-F]{64}$/);

export type CatalogProduct = {
  sku: Sku;
  name: string;
  unit: string;
  unitPriceMicroUsdc: bigint;
  stockMilli: number;
};

export type MerchantRuntime = Merchant & {
  privateKey: `0x${string}`;
  products: readonly CatalogProduct[];
};

type MerchantSeed = Omit<
  MerchantRuntime,
  "walletAddress" | "privateKey" | "supportedSkus"
> & {
  privateKeyEnv: string;
};

const merchantSeeds: readonly MerchantSeed[] = [
  {
    id: "11111111-1111-4111-8111-111111111111",
    slug: "ali-butcher",
    name: "Ali Butcher",
    category: "butcher",
    lat: 39.9208,
    lng: 32.8541,
    qualityScore: 9.1,
    canNegotiate: true,
    canReserve: false,
    privateKeyEnv: "MERCHANT_ALI_PRIVATE_KEY",
    products: [
      {
        sku: "BEEF_GROUND",
        name: "Premium ground beef",
        unit: "kg",
        unitPriceMicroUsdc: 1_800_000n,
        stockMilli: 50_000,
      },
      {
        sku: "BEEF_STEAK",
        name: "Beef steak",
        unit: "kg",
        unitPriceMicroUsdc: 3_500_000n,
        stockMilli: 20_000,
      },
      {
        sku: "LAMB_CHOP",
        name: "Lamb chops",
        unit: "kg",
        unitPriceMicroUsdc: 4_200_000n,
        stockMilli: 15_000,
      },
    ],
  },
  {
    id: "22222222-2222-4222-8222-222222222222",
    slug: "can-butcher",
    name: "Can Butcher",
    category: "butcher",
    lat: 39.9195,
    lng: 32.856,
    qualityScore: 7.2,
    canNegotiate: true,
    canReserve: false,
    privateKeyEnv: "MERCHANT_CAN_PRIVATE_KEY",
    products: [
      {
        sku: "BEEF_GROUND",
        name: "Ground beef",
        unit: "kg",
        unitPriceMicroUsdc: 1_500_000n,
        stockMilli: 80_000,
      },
      {
        sku: "CHICKEN_WHOLE",
        name: "Whole chicken",
        unit: "piece",
        unitPriceMicroUsdc: 1_200_000n,
        stockMilli: 30_000,
      },
    ],
  },
  {
    id: "33333333-3333-4333-8333-333333333333",
    slug: "zeynep-greengrocer",
    name: "Zeynep Greengrocer",
    category: "greengrocer",
    lat: 39.9215,
    lng: 32.8555,
    qualityScore: 8.4,
    canNegotiate: true,
    canReserve: false,
    privateKeyEnv: "MERCHANT_ZEYNEP_PRIVATE_KEY",
    products: [
      {
        sku: "ONION",
        name: "Onion",
        unit: "kg",
        unitPriceMicroUsdc: 300_000n,
        stockMilli: 200_000,
      },
      {
        sku: "TOMATO",
        name: "Tomato",
        unit: "kg",
        unitPriceMicroUsdc: 450_000n,
        stockMilli: 150_000,
      },
      {
        sku: "PARSLEY",
        name: "Parsley",
        unit: "bunch",
        unitPriceMicroUsdc: 100_000n,
        stockMilli: 50_000,
      },
      {
        sku: "PEPPER_GREEN",
        name: "Green pepper",
        unit: "kg",
        unitPriceMicroUsdc: 350_000n,
        stockMilli: 100_000,
      },
    ],
  },
  {
    id: "44444444-4444-4444-8444-444444444444",
    slug: "cem-bakery",
    name: "Cem Bakery",
    category: "bakery",
    lat: 39.922,
    lng: 32.8548,
    qualityScore: 8.8,
    canNegotiate: false,
    canReserve: true,
    privateKeyEnv: "MERCHANT_CEM_PRIVATE_KEY",
    products: [
      {
        sku: "BREAD_WHITE",
        name: "White bread",
        unit: "loaf",
        unitPriceMicroUsdc: 150_000n,
        stockMilli: 100_000,
      },
      {
        sku: "PIDE",
        name: "Pide bread",
        unit: "piece",
        unitPriceMicroUsdc: 250_000n,
        stockMilli: 30_000,
      },
      {
        sku: "SIMIT",
        name: "Simit",
        unit: "piece",
        unitPriceMicroUsdc: 100_000n,
        stockMilli: 50_000,
      },
    ],
  },
  {
    id: "55555555-5555-4555-8555-555555555555",
    slug: "mini-market",
    name: "Mini Market",
    category: "market",
    lat: 39.92,
    lng: 32.857,
    qualityScore: 6.9,
    canNegotiate: false,
    canReserve: false,
    privateKeyEnv: "MERCHANT_MARKET_PRIVATE_KEY",
    products: [
      {
        sku: "BEEF_GROUND",
        name: "Packed ground beef",
        unit: "kg",
        unitPriceMicroUsdc: 2_050_000n,
        stockMilli: 30_000,
      },
      {
        sku: "ONION",
        name: "Onion",
        unit: "kg",
        unitPriceMicroUsdc: 390_000n,
        stockMilli: 60_000,
      },
      {
        sku: "TOMATO",
        name: "Tomato",
        unit: "kg",
        unitPriceMicroUsdc: 560_000n,
        stockMilli: 60_000,
      },
      {
        sku: "PARSLEY",
        name: "Parsley",
        unit: "bunch",
        unitPriceMicroUsdc: 140_000n,
        stockMilli: 20_000,
      },
      {
        sku: "BREAD_WHITE",
        name: "Packaged white bread",
        unit: "loaf",
        unitPriceMicroUsdc: 220_000n,
        stockMilli: 30_000,
      },
      {
        sku: "EGGS_12",
        name: "Free-range eggs",
        unit: "dozen",
        unitPriceMicroUsdc: 1_100_000n,
        stockMilli: 20_000,
      },
      {
        sku: "OIL_SUNFLOWER",
        name: "Sunflower oil",
        unit: "litre",
        unitPriceMicroUsdc: 1_200_000n,
        stockMilli: 20_000,
      },
      {
        sku: "OIL_OLIVE",
        name: "Olive oil",
        unit: "litre",
        unitPriceMicroUsdc: 2_100_000n,
        stockMilli: 20_000,
      },
      {
        sku: "SALT",
        name: "Salt",
        unit: "kg",
        unitPriceMicroUsdc: 200_000n,
        stockMilli: 100_000,
      },
      {
        sku: "PEPPER_BLACK",
        name: "Black pepper",
        unit: "pack",
        unitPriceMicroUsdc: 150_000n,
        stockMilli: 50_000,
      },
      {
        sku: "CUMIN",
        name: "Cumin",
        unit: "pack",
        unitPriceMicroUsdc: 180_000n,
        stockMilli: 40_000,
      },
      {
        sku: "TOMATO_PASTE",
        name: "Tomato paste",
        unit: "jar",
        unitPriceMicroUsdc: 400_000n,
        stockMilli: 30_000,
      },
      {
        sku: "CHARCOAL",
        name: "Charcoal",
        unit: "kg",
        unitPriceMicroUsdc: 750_000n,
        stockMilli: 40_000,
      },
    ],
  },
];

export function loadMerchantCatalog(
  env: NodeJS.ProcessEnv = process.env,
): MerchantRuntime[] {
  return merchantSeeds.map(({ privateKeyEnv, ...seed }) => {
    const privateKey = PrivateKeySchema.parse(
      env[privateKeyEnv],
    ) as `0x${string}`;
    const account = privateKeyToAccount(privateKey);
    return {
      ...seed,
      privateKey,
      walletAddress: account.address,
      supportedSkus: [...new Set(seed.products.map((product) => product.sku))],
    };
  });
}
