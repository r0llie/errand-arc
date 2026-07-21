import { randomUUID } from "node:crypto";
import { createGatewayMiddleware } from "@circle-fin/x402-batching/server";
import cors from "cors";
import express, {
  type Express,
  type NextFunction,
  type Request,
  type Response,
} from "express";
import { z } from "zod";
import type { MerchantPaymentReceipt } from "@errand/shared";
import { loadMerchantCatalog, type MerchantRuntime } from "./catalog.js";
import { createSignedQuote, QuoteRequestSchema } from "./quote.js";

export function createApp(
  catalog: MerchantRuntime[] = loadMerchantCatalog(),
): Express {
  const app = express();
  const receipts: MerchantPaymentReceipt[] = [];
  app.disable("x-powered-by");
  app.use(
    cors({
      origin: [
        process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000",
        "http://127.0.0.1:3000",
      ],
    }),
  );
  app.use(express.json({ limit: "32kb" }));

  app.get("/health", (_request, response) => {
    response.json({ ok: true, service: "merchant-api" });
  });

  app.get("/merchants", (_request, response) => {
    response.json(
      catalog.map(
        ({ privateKey: _privateKey, products: _products, ...merchant }) =>
          merchant,
      ),
    );
  });

  app.get("/receipts", (_request, response) => {
    response.json([...receipts].reverse());
  });

  for (const merchant of catalog) {
    const gateway = createGatewayMiddleware({
      sellerAddress: merchant.walletAddress,
      facilitatorUrl: "https://gateway-api-testnet.circle.com",
      networks: ["eip155:5042002"],
      description: `Errand quote from ${merchant.name}`,
    });
    gateway.onAfterSettle(async ({ requirements, result }) => {
      if (!result.success) return;
      const receiptId = result.transaction || randomUUID();
      if (receipts.some((receipt) => receipt.id === receiptId)) return;
      receipts.push({
        id: receiptId,
        merchantId: merchant.id,
        merchantName: merchant.name,
        payer: result.payer ?? "",
        payee: merchant.walletAddress,
        amountMicroUsdc: requirements.amount,
        network: "eip155:5042002",
        endpoint: `/merchants/${merchant.id}/quote`,
        mode: "gateway",
        transaction: result.transaction,
        createdAt: new Date().toISOString(),
      });
    });

    app.post(
      `/merchants/${merchant.id}/quote`,
      gateway.require("$0.0005"),
      async (request, response, next) => {
        try {
          const input = QuoteRequestSchema.parse(request.body);
          const quote = await createSignedQuote(merchant, input);
          const payment = (
            request as Request & {
              payment?: {
                verified: boolean;
                payer: string;
                amount: string;
                network: string;
                transaction?: string;
              };
            }
          ).payment;
          if (!payment?.verified)
            throw new Error("Verified payment is missing");
          response.json(quote);
        } catch (error) {
          next(error);
        }
      },
    );

    if (process.env.DEMO_MODE !== "false") {
      app.post(
        `/demo/merchants/${merchant.id}/quote`,
        async (request, response, next) => {
          try {
            const input = QuoteRequestSchema.parse(request.body);
            const quote = await createSignedQuote(merchant, input);
            const paymentId = randomUUID();
            const createdAt = new Date().toISOString();
            receipts.push({
              id: paymentId,
              merchantId: merchant.id,
              merchantName: merchant.name,
              payer: "0x0000000000000000000000000000000000000001",
              payee: merchant.walletAddress,
              amountMicroUsdc: "500",
              network: "eip155:5042002",
              endpoint: `/merchants/${merchant.id}/quote`,
              mode: "simulated",
              createdAt,
            });
            response.json({
              quote,
              payment: {
                id: paymentId,
                merchantId: merchant.id,
                merchantName: merchant.name,
                amountMicroUsdc: "500",
                network: "eip155:5042002",
                status: "settled",
                mode: "simulated",
                createdAt,
              },
            });
          } catch (error) {
            next(error);
          }
        },
      );
    }
  }

  app.use(
    (
      error: unknown,
      _request: Request,
      response: Response,
      _next: NextFunction,
    ) => {
      if (error instanceof z.ZodError) {
        response
          .status(400)
          .json({ error: "invalid_request", issues: error.issues });
        return;
      }
      console.error("Merchant API request failed", error);
      response.status(500).json({ error: "internal_error" });
    },
  );

  return app;
}
