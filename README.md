# Errand

Errand is an Arc-native autonomous commerce agent for Circle's Agentic Economy track. A shopper states an intent; the agent ranks local merchants from SKU coverage, quality, distance, and negotiability, spends a bounded USDC research budget through Circle Gateway/x402, verifies signed offers, and prepares conditional Arc escrow settlement for the selected basket.

## What is implemented

- English Next.js shopper and merchant experiences
- complete two-sided local task loop: intent parsing, signal-based merchant selection, quote purchase, plan selection, order funding, preparation, pickup, and completion
- Arc Testnet and USDC shared configuration
- deterministic merchant catalog and signed EIP-712 quote generation
- Circle Gateway/x402 protected merchant quote endpoints
- funded Arc Testnet Gateway buyer wallet, live balance endpoint, POST-aware 402 preflight, and deterministic research policy
- atomic in-process pending/settled/failed budget reservations with idempotency keys
- independent agent verification of each quote's EIP-712 signer, item hash, total, nonce, and expiry
- merchant-side x402 receipt ledger showing payer, payee, amount, network, endpoint, and settlement identifier
- secure `OrderEscrow` Solidity contract with pickup-code release, pre-preparation cancellation, timeout refunds, disputes, liability accounting, and five Hardhat tests
- secure Supabase schema with budget reservation and settlement functions
- unit tests for money, distance, quote totals, and signature recovery

The local demo uses real merchant EIP-712 signatures and clearly labels simulated x402 and escrow settlement. Real mode uses the funded Gateway balance and protected merchant endpoints. `OrderEscrow` is deployed on Arc Testnet at `0x40a97F02cBA40C9DcB6fc6845384C65FFA971749`; the evidence ledger records the deployment, paid x402 proof run, and merchant gas funding.

Set both `DEMO_MODE=false` and `NEXT_PUBLIC_DEMO_MODE=false` to route quote purchases through the protected merchant endpoints with `GatewayClient.pay()`. Real mode refuses to start unless the Gateway balance can cover the bounded research plan.

Before spending, inspect the exact live 402 plan without moving funds:

```bash
curl -X POST http://localhost:3001/research/preview \
  -H "Content-Type: application/json" \
  -d '{"prompt":"I am making meatballs for 4 people"}'
```

The preview validates every merchant's POST `402 Payment Required` response, Arc network, USDC token, price, and payee.

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
pnpm --filter @errand/agent gateway:deposit 1
```

## Escrow contract

```bash
pnpm --filter @errand/contracts build
pnpm --filter @errand/contracts test
pnpm --filter @errand/contracts deploy:arc
pnpm --filter @errand/contracts demo:preview
```

The deploy command submits a real Arc Testnet transaction from the funded `AGENT_WALLET_PRIVATE_KEY`. Do not run it without reviewing the deployment target and gas estimate.

`demo:preview` is read-only: it verifies the deployed contract, exact buyer and merchant accounts, balances, allowance, fixed unused order ID, 1.5 USDC principal, and a 0.02 USDC maximum lifecycle gas bound. `demo:execute` moves funds and must only be run after explicit approval of that complete preview.

After deployment, set `ESCROW_CONTRACT_ADDRESS`, switch both demo flags to `false`, and restart the services. The shopper UI then:

1. connects an injected EVM wallet and verifies Arc Testnet (`5042002`);
2. checks the single 6-decimal USDC balance and allowance;
3. requests explicit wallet signatures for USDC approval and `OrderEscrow.fund`;
4. verifies the emitted order event before changing local state.

The merchant UI requires the exact merchant wallet for `markPreparing`, `markReady`, and `confirmPickup`. The shopper generates the salted pickup proof locally; the merchant API never receives or exposes that secret. Every verified transaction links to Arcscan.

## Verify

```bash
pnpm typecheck
pnpm test
pnpm build
```

Private keys, service-role keys, and recovery material must stay server-side and must never be committed. See `docs/08-ARC-AGENTIC-IMPLEMENTATION.md` for the product and protocol source of truth.

See `docs/09-HACKATHON-SUBMISSION.md` for the judge-facing architecture, proof ledger, demo script, and submission checklist.
