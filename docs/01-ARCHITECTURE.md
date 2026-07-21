# Errand — Architecture

> Read `08-ARC-AGENTIC-IMPLEMENTATION.md` first. It overrides older examples in
> this file when wallet, payment, identifier, or contract details differ.

## Monorepo Structure

```
errand/
├── apps/
│   ├── web/                    # Next.js 15 — user app + merchant console  :3000
│   ├── agent/                  # Hono/Node — AI agent + Gateway buyer       :3001
│   └── merchant-api/           # Express/Node — x402 merchant sellers       :4000
├── packages/
│   ├── shared/                 # Zod schemas, SKUs, EIP-712, USDC utils
│   └── contracts/              # Hardhat project
├── supabase/
│   └── migrations/             # DB schema
├── scripts/
│   ├── seed.ts                 # Seed merchants + products
│   └── demo.ts                 # End-to-end demo script
├── .env.example
├── package.json                # pnpm workspaces
└── turbo.json
```

## Tech Stack

| Layer             | Choice                                   | Why                                                                 |
| ----------------- | ---------------------------------------- | ------------------------------------------------------------------- |
| Monorepo          | pnpm workspaces + Turborepo              | Fast, standard                                                      |
| Web               | Next.js 15, React 19, Tailwind v4        | App Router, Server Actions                                          |
| Backend           | Hono + Express (Node)                    | Hono for the agent; Express for Circle's official seller middleware |
| AI                | Vercel AI SDK + Claude claude-sonnet-4-6 | Tool calling, streaming                                             |
| User wallet       | Privy                                    | User-controlled login and escrow signatures                         |
| Agent wallet      | Dedicated Arc EOA                        | Required for Gateway EIP-3009 nanopayment signatures                |
| DB                | Supabase (Postgres)                      | Realtime, free tier                                                 |
| Contracts         | Hardhat + viem                           | Arc testnet deploy                                                  |
| Chain             | Arc Testnet                              | Hackathon requirement                                               |
| Research payments | Circle Gateway Nanopayments + x402       | Gasless sub-cent agent spending                                     |
| Order payments    | ERC-20 USDC + custom escrow              | Conditional pickup settlement                                       |
| Animations        | Framer Motion                            | Polish                                                              |

## Apps Detail

### apps/web (Next.js 15, :3000)

**Pages:**

- `/` — Landing + wallet connect
- `/shop` — Main shopping interface (prompt → agent stream → options → approve)
- `/orders` — Active orders + escrow status
- `/receipt/[taskId]` — Final receipt with tx hashes
- `/merchant` — Merchant console (order board + delivery code input)
- `/merchant/[id]` — Specific merchant dashboard

**Key Components:**

- `<WalletConnect />` — Privy integration, balance display
- `<PromptInput />` — Natural language input with suggestions
- `<AgentTimeline />` — Live SSE stream visualization
- `<MerchantCard />` — Discovery card with distance, rating, price badge
- `<QuoteCard />` — Signed offer with TTL countdown
- `<OptionCard />` — Cheapest / Best Quality / Pickup Route
- `<EscrowTimeline />` — Funded → Preparing → Ready → Released
- `<DeliveryCodeInput />` — Merchant side, triggers escrow release
- `<ReceiptPage />` — Full breakdown, tx links

### apps/agent (Hono, :3001)

**Endpoints:**

- `POST /tasks` — Start new shopping task
- `GET /tasks/:id/stream` — SSE stream of agent progress
- `POST /tasks/:id/select-option` — User picks option
- `POST /tasks/:id/approve` — Record intent and return unsigned funding calls
- `POST /tasks/:id/funding-complete` — Verify user-signed Arc receipts
- `POST /tasks/:id/cancel` — Cancel + refund
- `GET /tasks/:id` — Task state

**Agent Orchestration (state machine):**

```
idle → parsing → discovering → quoting → negotiating → presenting
     → awaiting_selection → awaiting_approval → funding_escrow
     → monitoring → completed | refunded | cancelled
```

**AI Tools (Vercel AI SDK):**

- `parseShopping` — Natural language → SKU list
- `discoverMerchants` — Find nearby merchants for SKUs
- `queryMerchant` — Pay micropayment + get quote (x402)
- `negotiatePrice` — Request discount if available
- `buildOptions` — Compose 3 option sets
- `buildFundingPlan` — Build exact approval/funding calldata for the user wallet
- `verifyDelivery` — Confirm pickup code

## Database Schema (Supabase)

```sql
-- Merchants
merchants (
  id uuid PK,
  name text,
  category text,          -- kasap | manav | fırın | market
  lat float,
  lng float,
  wallet_address text,    -- receives USDC
  quality_score float,    -- 0-10
  can_negotiate bool,
  can_reserve bool,
  is_active bool,
  created_at timestamptz
)

-- Products
products (
  id uuid PK,
  merchant_id uuid FK,
  sku text,               -- canonical SKU from shared package
  name text,
  price_micro_usdc bigint, -- integer, 6 decimals
  stock int,
  unit text,              -- kg | adet | paket
  created_at timestamptz
)

-- Tasks (shopping sessions)
tasks (
  id uuid PK,
  user_wallet text,
  prompt text,
  status text,            -- state machine status
  skus jsonb,             -- parsed SKU list
  options jsonb,          -- 3 generated options
  selected_option jsonb,
  research_spent_micro_usdc bigint DEFAULT 0,
  state_log jsonb[],      -- full history
  created_at timestamptz,
  updated_at timestamptz
)

-- Orders (per merchant, per task)
orders (
  id uuid PK,
  task_id uuid FK,
  merchant_id uuid FK,
  items jsonb,            -- [{sku, qty, price_micro_usdc}]
  total_micro_usdc bigint,
  status text,            -- quoted|reserved|paid|preparing|ready|completed|refunded
  escrow_tx_hash text,
  release_tx_hash text,
  delivery_code text,     -- hashed
  delivery_code_expires_at timestamptz,
  pickup_deadline timestamptz,
  created_at timestamptz,
  updated_at timestamptz
)

-- Micropayment ledger
micropayments (
  id uuid PK,
  task_id uuid FK,
  merchant_id uuid FK,
  endpoint text,          -- quote|negotiate|reserve|inventory
  amount_micro_usdc bigint,
  tx_hash text,
  idempotency_key text UNIQUE,
  created_at timestamptz
)

-- Quotes (EIP-712 signed)
quotes (
  id uuid PK,
  order_id uuid FK,
  merchant_id uuid FK,
  items jsonb,
  total_micro_usdc bigint,
  signature text,
  valid_until timestamptz,
  nonce text,
  is_used bool DEFAULT false,
  created_at timestamptz
)
```

## Payment Flow (Gateway x402)

```
Agent → POST /merchants/:id/quote
      ← 402 + PAYMENT-REQUIRED
Agent → sign EIP-3009 authorization offchain
      → retry + PAYMENT-SIGNATURE
Merchant API → settle through Gateway facilitator
      ← 200 quote + PAYMENT-RESPONSE
```

Do not implement custom `X-Payment-Tx` headers. Use
`@circle-fin/x402-batching` on both buyer and seller sides.

**Budget enforcement:**

- Max 0.01 USDC total research per task
- Max 0.002 USDC per single request
- Check before every payment (including pending)

## Contract Architecture

```
contracts/
├── src/
│   ├── OrderEscrow.sol      # Core escrow contract
│   └── MerchantRegistry.sol # Optional on-chain merchant index
├── test/
│   ├── OrderEscrow.t.sol
│   └── MerchantRegistry.t.sol
└── hardhat.config.ts
```

### OrderEscrow.sol

```solidity
// Key functions:
fund(orderId, merchantWallet, amount)     // User locks USDC
markPreparing(orderId)                    // Merchant: started
markReady(orderId)                        // Merchant: ready for pickup
confirmPickup(orderId, deliveryCode)      // merchant submits code → release
refund(orderId)                           // pre-preparation cancel or deadline refund
```

**State:** `funded → preparing → ready → completed | refunded`

Uses: OpenZeppelin SafeERC20 + ReentrancyGuard + AccessControl

## Environment Variables

```bash
# Arc Testnet
ARC_TESTNET_RPC_URL=
ARC_CHAIN_ID=
ARC_USDC_ADDRESS=
ESCROW_CONTRACT_ADDRESS=
MERCHANT_REGISTRY_ADDRESS=
AGENT_WALLET_PRIVATE_KEY=

# Privy
NEXT_PUBLIC_PRIVY_APP_ID=

# Supabase
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=

# AI
ANTHROPIC_API_KEY=

# Agent EOA (server-only, pays Gateway nanopayments)
AGENT_WALLET_PRIVATE_KEY=
AGENT_WALLET_ADDRESS=
GATEWAY_API_URL=https://gateway-api-testnet.circle.com

# App
NEXT_PUBLIC_APP_URL=http://localhost:3000
AGENT_URL=http://localhost:3001
```
