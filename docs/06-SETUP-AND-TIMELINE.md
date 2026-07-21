# Errand — Setup & Build Timeline

> Updated Arc implementation details and acceptance criteria live in
> `08-ARC-AGENTIC-IMPLEMENTATION.md`. Build the real payment spine before polish.

## Checkpoint 2 Sprint — 21–26 July 2026

1. **21 July:** freeze architecture, scaffold workspace, shared schemas, migrations.
2. **22 July:** merchant API with real Gateway x402 seller middleware.
3. **23 July:** agent EOA, Gateway deposit, autonomous paid quote loop, budget ledger.
4. **24 July:** secure escrow contract, tests, Arc deployment, browser funding flow.
5. **25 July:** shop timeline, options, merchant console, recorded happy-path run.
6. **26 July:** public repository, progress summary, tx links, short checkpoint video.

Checkpoint 2 does not require the final UI. It must prove the riskiest integration:
the agent autonomously buying merchant data with real USDC Nanopayments on Arc.

## Initial Setup

### 1. Create Monorepo

```bash
mkdir errand && cd errand
pnpm init
```

### pnpm-workspace.yaml

```yaml
packages:
  - "apps/*"
  - "packages/*"
```

### package.json (root)

```json
{
  "name": "errand",
  "private": true,
  "scripts": {
    "dev": "turbo dev",
    "build": "turbo build",
    "typecheck": "turbo typecheck",
    "test": "turbo test",
    "db:seed": "tsx scripts/seed.ts",
    "contracts:deploy": "cd packages/contracts && pnpm hardhat run scripts/deploy.ts --network arcTestnet"
  },
  "devDependencies": {
    "turbo": "^2",
    "typescript": "^5",
    "tsx": "^4"
  }
}
```

### turbo.json

```json
{
  "$schema": "https://turbo.build/schema.json",
  "tasks": {
    "dev": { "persistent": true, "cache": false },
    "build": { "dependsOn": ["^build"], "outputs": [".next/**", "dist/**"] },
    "typecheck": { "dependsOn": ["^typecheck"] },
    "test": { "cache": false }
  }
}
```

---

## Environment Setup

### Arc Testnet

1. Go to Arc docs: https://docs.arc.io/
2. Get testnet RPC URL and chain ID
3. Get USDC testnet contract address
4. Use faucet to get testnet USDC

### Privy

1. Go to https://privy.io/
2. Create app → get App ID
3. Configure: enable email + embedded wallets

### Supabase

1. Go to https://supabase.com/
2. Create project → get URL + anon key + service role key
3. Run migrations (SQL in 01-ARCHITECTURE.md)

### Anthropic

1. Get API key from https://console.anthropic.com/

---

## Build Order (follow this exactly)

### Phase 1 — Foundation (Day 1)

Build in this order:

1. **packages/shared** — skus, schemas, eip712, usdc, distance
   - No dependencies, pure TypeScript
   - Test: `pnpm typecheck` should pass

2. **Supabase schema** — run the SQL from 01-ARCHITECTURE.md
   - Create all tables
   - Enable realtime on `orders` table

3. **packages/contracts** — OrderEscrow + MerchantRegistry
   - Install Hardhat
   - Write contracts (copy from 03-CONTRACTS.md)
   - Deploy to Arc testnet
   - Save contract addresses to .env

4. **apps/web skeleton**
   - Next.js 15 with App Router
   - Tailwind v4 + globals.css tokens
   - Privy provider
   - Basic layout: header with wallet connect
   - Just the shell, no agent logic yet

### Phase 2 — Agent + Merchants (Day 2)

5. **apps/merchant-api — merchant server first**
   - Express server at :4000 (Circle Gateway seller middleware)
   - Seed data loaded from scripts/seed.ts
   - Endpoints: /inventory, /quote (with 402 gate)
   - Circle Gateway x402 seller middleware
   - Test: unpaid request returns 402; `GatewayClient.pay()` returns 200

6. **apps/agent — AI bridge**
   - Hono server at :3001
   - parseShopping tool (Claude)
   - discoverMerchants (Supabase + Haversine)
   - queryMerchant (x402 flow)
   - buildOptions (3 option types)
   - SSE stream working
   - Test: POST /tasks → stream events → options appear

### Phase 3 — Escrow Flow (Day 3)

7. **Escrow funding — browser signs, agent verifies**
   - Agent builds exact approval and escrow calldata
   - Privy browser wallet submits the Arc transactions
   - Agent verifies receipts before creating/updating paid orders
   - Monitoring uses persisted events with replayable SSE updates

8. **apps/web — merchant console**
   - /merchant page
   - Supabase realtime subscription
   - Order cards with status buttons
   - Delivery code input + verification
   - Merchant wallet calls `OrderEscrow.confirmPickup`; agent verifies the receipt

### Phase 4 — Full UI (Day 4-5)

9. **apps/web — main shop flow**
   - PromptInput component
   - AgentTimeline (SSE hook)
   - MerchantDiscoveryCards
   - OptionCards with TTL countdown
   - PaymentApproval modal
   - EscrowStatus timeline

10. **apps/web — receipt + polish**
    - /receipt/[taskId] page
    - /orders page
    - Framer Motion animations
    - Mobile responsive
    - Error + loading states

### Phase 5 — Glaze (Day 6+)

11. **Polish pass**
    - Micro-interactions
    - Confetti on escrow release
    - Demo script (scripts/demo.ts)
    - README

12. **Checkpoint 2 prep**
    - Record demo video (screen record + voiceover)
    - Push to GitHub (public repo)
    - Submit checkpoint

---

## File Creation Order for Coding Agent

Give the coding agent files in this order:

```
1. 00-PROJECT-BRIEF.md                → understand the product
2. 08-ARC-AGENTIC-IMPLEMENTATION.md   → authoritative Arc implementation
3. 01-ARCHITECTURE.md                 → understand service boundaries
4. 02-SHARED-PACKAGE.md               → build shared package first
5. 03-CONTRACTS.md                    → implement invariants, never blind-copy
6. 04-AGENT.md                        → build agent + merchant API
7. 05-FRONTEND.md                     → build frontend last
```

---

## Key Commands

```bash
# Install everything
pnpm install

# Seed merchant data
pnpm db:seed

# Deploy contracts to Arc testnet
pnpm contracts:deploy

# Run everything
pnpm dev
# web: http://localhost:3000
# agent: http://localhost:3001
# merchants: http://localhost:4000

# Test agent directly
curl -X POST http://localhost:3001/tasks \
  -H "Content-Type: application/json" \
  -d '{"userWallet":"0x...","prompt":"4 kişilik köfte","userLat":39.9208,"userLng":32.8541}'

# Type check
pnpm typecheck

# Run tests
pnpm test
```

---

## Arc Testnet Checklist

- [ ] RPC URL added to .env
- [ ] Chain ID added to .env
- [ ] USDC testnet address added to .env
- [ ] Deployer wallet funded with testnet tokens
- [ ] Agent wallet funded with testnet USDC (for micropayments)
- [ ] OrderEscrow deployed + address saved
- [ ] MerchantRegistry deployed + address saved
- [ ] Merchants registered on-chain via seed script
- [ ] Test escrow fund → release flow with curl/script

---

## Demo Script Flow

```
1. Open http://localhost:3000
2. Connect wallet (Privy email login)
3. Type: "4 kişilik köfte yapacağım"
4. Watch agent timeline:
   - SKUs parsed (kıyma, soğan, maydanoz, ekmek, baharatlar)
   - 5 esnaf keşfedildi
   - Her esnafa sorgu + mikro-ödeme (Arc txler)
   - Teklifler toplandı + imzalandı
   - 3 seçenek hazır
5. Select "En Ucuz" option
6. Approve payment → escrow funded (real Arc tx)
7. Open new tab: http://localhost:3000/merchant
8. Select "Ali Kasap"
9. See order, click "Hazırlamaya Başla"
10. Click "Hazır İşaretle"
11. Enter delivery code → escrow releases → merchant gets USDC
12. Back to user tab → see "Tamamlandı" + receipt
```
