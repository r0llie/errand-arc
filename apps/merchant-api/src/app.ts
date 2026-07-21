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
import { loadMerchantCatalog, type MerchantRuntime } from "./catalog.js";
import { createSignedQuote, QuoteRequestSchema } from "./quote.js";

export function createApp(
  catalog: MerchantRuntime[] = loadMerchantCatalog(),
): Express {
  const app = express();
  app.disable("x-powered-by");
  app.use(
    cors({
      origin: process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000",
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

  for (const merchant of catalog) {
    const gateway = createGatewayMiddleware({
      sellerAddress: merchant.walletAddress,
      facilitatorUrl: "https://gateway-api-testnet.circle.com",
      networks: ["eip155:5042002"],
      description: `Errand quote from ${merchant.name}`,
    });

    app.post(
      `/merchants/${merchant.id}/quote`,
      gateway.require("$0.0005"),
      async (request, response, next) => {
        try {
          const input = QuoteRequestSchema.parse(request.body);
          const quote = await createSignedQuote(merchant, input);
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
            response.json({
              quote,
              payment: {
                id: randomUUID(),
                merchantId: merchant.id,
                merchantName: merchant.name,
                amountMicroUsdc: "500",
                network: "eip155:5042002",
                status: "settled",
                mode: "simulated",
                createdAt: new Date().toISOString(),
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
