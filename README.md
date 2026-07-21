# Errand

Errand is an Arc-native autonomous commerce prototype for Circle's Agentic Economy track. A user states an intent and a budget; the agent discovers local merchants, buys paid quotes through Circle Gateway/x402, verifies signed offers, and will settle the chosen basket in USDC.

## What is implemented

- English Next.js shopper and merchant experiences
- complete local task loop: intent parsing, discovery, quote purchase, plan selection, order funding, preparation, pickup, and completion
- Arc Testnet and USDC shared configuration
- deterministic merchant catalog and signed EIP-712 quote generation
- Circle Gateway/x402 protected merchant quote endpoints
- agent Gateway wallet, balance endpoint, and deterministic research policy
- secure Supabase schema with budget reservation and settlement functions
- unit tests for money, distance, quote totals, and signature recovery

The local demo uses real merchant EIP-712 signatures and clearly labeled simulated x402 and escrow settlement. Funded Arc Testnet payments and the Solidity escrow deployment remain the next production-facing slice.

## Run locally

Requirements: Node.js 22+ and pnpm 11.

```bash
pnpm install
pnpm demo:wallets
pnpm dev
```

`pnpm demo:wallets` creates an ignored `.env.local` exactly once and prints only public addresses. Fund the agent address with Arc Testnet USDC before trying a Gateway deposit. Add Supabase and AI credentials to `.env.local` when those services are enabled.

Services:

- web: `http://localhost:3000`
- agent API: `http://localhost:3001`
- merchant API: `http://localhost:4000`

Open `http://localhost:3000/shop` and `http://localhost:3000/merchant` in two tabs. Start a task in the shopper view, approve one of the three plans, then advance every order from the merchant console. Both tabs poll the same agent state and update live.

## Gateway funding

This command moves real testnet USDC and is never run automatically:

```bash
pnpm --filter @errand/agent gateway:deposit -- 1
```

## Verify

```bash
pnpm typecheck
pnpm test
pnpm build
```

Private keys, service-role keys, and recovery material must stay server-side and must never be committed. See `docs/08-ARC-AGENTIC-IMPLEMENTATION.md` for the product and protocol source of truth.
