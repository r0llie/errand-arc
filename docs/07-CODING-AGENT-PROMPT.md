# Errand — Coding Agent Master Prompt

> Always read `08-ARC-AGENTIC-IMPLEMENTATION.md` before writing code. It is the
> source of truth and overrides conflicting legacy snippets in documents `01`–`06`.

Use this as the system prompt / first message when starting a coding session.

---

## Master Prompt

```
You are building "Errand" — an AI-powered local shopping agent app for a blockchain hackathon.

## What you're building
A full-stack TypeScript monorepo (pnpm workspaces + Turborepo) where:
- Users describe what they need in Turkish plain language
- An AI agent (Claude claude-sonnet-4-6 via Vercel AI SDK) parses the request into SKUs
- The agent discovers nearby merchants from a database (Haversine distance)
- The agent spends its own bounded Gateway balance through standard x402
  Nanopayments to query selected merchants
- The agent presents 3 shopping options: Cheapest / Best Quality / Pickup Route
- User approves → USDC locked in on-chain escrow per merchant (Arc Testnet)
- Merchant confirms order ready → User picks up → Enters delivery code → Escrow releases

## Tech stack
- Monorepo: pnpm workspaces + Turborepo
- Web: Next.js 15 (App Router), React 19, Tailwind v4, Framer Motion, Zustand
- Backend: Hono for the agent and Express for Circle's Gateway merchant middleware
- AI: Vercel AI SDK + Anthropic Claude claude-sonnet-4-6
- User wallet: Privy; agent wallet: dedicated Arc Testnet EOA for Gateway signatures
- DB: Supabase (Postgres + Realtime)
- Chain: Arc Testnet
- Contracts: Hardhat + viem + OpenZeppelin
- Payments: Gateway Nanopayments for research; ERC-20 USDC escrow for orders

## Build order
1. packages/shared — types, schemas, SKU registry, EIP-712, USDC utils
2. packages/contracts — OrderEscrow.sol + MerchantRegistry.sol
3. apps/merchant-api — x402 sellers (:4000)
4. apps/agent — AI bridge + Gateway buyer (:3001)
5. apps/web — Next.js frontend (:3000)

## Non-negotiables
- TypeScript strict mode everywhere
- Zod validation on all API boundaries
- LLM never generates prices — all prices from DB
- All prices in micro-USDC (integer, 6 decimals)
- EIP-712 signed quotes with validUntil + nonce
- Atomic budget reservation before every micropayment, including pending spend
- Standard PAYMENT-REQUIRED / PAYMENT-SIGNATURE / PAYMENT-RESPONSE headers via SDK
- User purchase funds never move without an explicit user wallet signature
- Real USDC transfers on Arc Testnet (not mock)

## Design
- Dark mode, amber accent (#f59e0b), deep navy background (#0a0f1e)
- Framer Motion animations on all state transitions
- Mobile-first responsive
- Turkish UI text

## Reference files
I will provide you detailed specs for each layer. Read them carefully before coding.
Always ask if something is unclear. Write production-quality code, not hackathon trash.
```

---

## Session Starters

### Session 1: Shared Package

```
Read 02-SHARED-PACKAGE.md and build the entire packages/shared directory.
Also read 08-ARC-AGENTIC-IMPLEMENTATION.md for money and identifier rules.
Include: skus.ts, schemas.ts, eip712.ts, usdc.ts, distance.ts, index.ts
Set up package.json with proper exports.
Run typecheck and make sure it's clean.
```

### Session 2: Contracts

```
Read 03-CONTRACTS.md and build packages/contracts.
Write OrderEscrow.sol and MerchantRegistry.sol.
Set up Hardhat config for Arc Testnet.
Write deploy script.
Write basic tests for fund/release/refund flows.
```

### Session 3: Merchant Server

```
Read 04-AGENT.md (merchant server section) and 08-ARC-AGENTIC-IMPLEMENTATION.md.
Build apps/merchant-api at :4000.
Implement 5 merchants with seed data.
Implement Circle Gateway x402 seller middleware.
Endpoints: /inventory, /quote, /negotiate, /reserve, /orders
Test unpaid 402 and paid 200 through `GatewayClient.pay()`.
```

### Session 4: AI Agent Bridge

```
Read 04-AGENT.md (agent bridge section).
Build apps/agent AI bridge at :3001.
Implement: parseShopping, discoverMerchants, queryMerchant, buildOptions tools.
Implement state machine orchestrator.
Implement SSE streaming.
Implement budget enforcement.
Test: POST /tasks with a Turkish prompt → stream events → get 3 options.
```

### Session 5: Escrow + Orders

```
Continue apps/agent.
Implement `buildFundingPlan`; never sign with the user's wallet on the server.
Submit approval and escrow calls from the Privy-connected browser wallet.
Implement order creation in Supabase.
Implement delivery code generation + verification.
Implement receipt verification and replayable SSE updates.
```

### Session 6: Frontend

```
Read 05-FRONTEND.md.
Build apps/web with Next.js 15.
Implement: Privy, globals.css tokens, layout, all components.
Pages: /, /shop, /orders, /receipt/[taskId], /merchant
Make it beautiful. Framer Motion on everything.
```

### Session 7: Polish + Demo

```
Polish pass:
- Micro-interactions
- Error states
- Loading states
- Mobile responsive check
- Confetti on escrow release
Write scripts/demo.ts for end-to-end demo.
Write README.md.
```
