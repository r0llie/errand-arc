# Errand — Arc Agentic Economy Implementation

## Status

This document is the implementation source of truth for the Arc version of Errand.
When an older snippet in `00`–`07` conflicts with this file, this file wins.

Last verified against the Arc Docs MCP and Circle developer documentation on
2026-07-21.

## Track Fit

Errand targets the **Agentic Economy** track.

The economic actor is the shopping agent, not the chat interface. It:

1. turns a natural-language request into a constrained SKU list;
2. discovers merchants using database inventory and location signals;
3. decides which paid merchant APIs are worth querying;
4. spends its own bounded USDC research budget without per-request approval;
5. verifies signed merchant quotes and constructs ranked shopping plans;
6. asks the user for approval only when the user’s purchase funds will move;
7. follows Arc escrow events until pickup or refund.

This gives judges visible decision logic, autonomous spending, machine-to-machine
payments, and conditional USDC settlement.

## Circle and Arc Products Used

| Product              | Use in Errand                                              | MVP                              |
| -------------------- | ---------------------------------------------------------- | -------------------------------- |
| Arc Testnet          | All escrow and settlement transactions                     | Required                         |
| USDC                 | Agent research budget, merchant nanopayments, order escrow | Required                         |
| Gateway Nanopayments | Gasless sub-cent x402 merchant queries                     | Required                         |
| x402                 | HTTP payment negotiation between agent and merchants       | Required                         |
| Privy                | User login and user-controlled escrow signatures           | Required                         |
| ERC-8004             | Public identity for the Errand shopping agent              | Final-demo enhancement           |
| App Kit              | Optional bridge/funding path into Arc                      | Stretch                          |
| ERC-8183             | Agent job lifecycle                                        | Not used in the retail-order MVP |

ERC-8183 models agent jobs, deliverables, evaluation, and settlement. A local
pickup order has a different lifecycle, so Errand uses a purpose-built escrow.
Forcing ERC-8183 into the purchase flow would make the demo less coherent.

## Canonical Arc Configuration

```typescript
import { arcTestnet } from "viem/chains";

export const ARC_CHAIN = arcTestnet;
export const ARC_CHAIN_ID = 5_042_002;
export const ARC_RPC_URL = "https://rpc.testnet.arc.network";
export const ARC_EXPLORER_URL = "https://testnet.arcscan.app";
export const ARC_USDC = "0x3600000000000000000000000000000000000000";
export const ARC_GATEWAY_WALLET = "0x0077777d7EBA4688BDeF3E311b846F25870A19B9";
export const ARC_GATEWAY_DOMAIN = 26;
```

Contract addresses must be checked against the current official documentation
before deployment. Prefer `viem/chains` and the Gateway SDK’s chain configuration
over duplicating configuration in application code.

### Arc USDC accounting rule

Arc native USDC and the 6-decimal ERC-20 USDC interface expose the same underlying
balance. They are not two assets.

- Use the ERC-20 interface and 6 decimals for balances, transfers, approvals,
  prices, escrow amounts, and UI.
- Use the native 18-decimal view only for raw gas and `msg.value` calculations.
- Never add native and ERC-20 balances together.
- A wallet must retain enough USDC for both the transfer and gas.

## Wallet Model

### Shopping agent wallet

Use a dedicated **EOA buyer wallet** on Arc Testnet for Gateway Nanopayments.
Gateway’s nanopayment signature verification currently requires EOA signatures;
SCA/EIP-1271 signatures are not supported by the buyer quickstart.

For the hackathon MVP, load the EOA signing key from a server-side secret and use
`@circle-fin/x402-batching`. Never expose it to the browser, log it, or commit it.
The wallet holds only the research budget plus a small gas reserve.

Production evolution: move signing to an approved key-management or Circle wallet
integration once the chosen Gateway signing path is confirmed to support it.

### User wallet

The user owns the purchase funds. Privy connects the user wallet and the browser
submits the USDC approval and escrow funding transactions. The agent backend must
not pretend to sign on behalf of the user.

### Merchant wallets

Each seeded merchant has a distinct Arc EOA seller address. The seller address is
the x402 nanopayment recipient and the final escrow recipient.

## Payment Flows

### A. Agent-to-merchant research payment

Use the official Gateway x402 flow:

```text
Agent buyer -> merchant paid endpoint
Merchant    -> 402 + PAYMENT-REQUIRED
Agent buyer -> EIP-3009 authorization in PAYMENT-SIGNATURE
Merchant    -> Gateway settle + resource + PAYMENT-RESPONSE
Gateway     -> batched onchain settlement to merchant balance
```

Implementation packages:

```bash
pnpm add @circle-fin/x402-batching viem
```

Buyer:

```typescript
import { GatewayClient } from "@circle-fin/x402-batching/client";

const gateway = new GatewayClient({
  chain: "arcTestnet",
  privateKey: process.env.AGENT_WALLET_PRIVATE_KEY as `0x${string}`,
});

const support = await gateway.supports(url);
if (!support.supported)
  throw new Error("Merchant does not support Gateway x402");

const result = await gateway.pay(url, requestInit);
```

Seller:

```typescript
import { createGatewayMiddleware } from "@circle-fin/x402-batching/server";

const gateway = createGatewayMiddleware({
  sellerAddress: merchant.walletAddress,
  facilitatorUrl: "https://gateway-api-testnet.circle.com",
  networks: ["eip155:5042002"],
});
```

Use the SDK rather than custom `X-Payment-Tx` headers. Persist the authorization or
settlement identifier returned by the SDK, network, payer, payee, endpoint, amount,
and idempotency key.

Before the first payment, deposit a small amount of USDC into Gateway once. The
subsequent per-request authorizations are gasless and settle in batches.

### B. User-to-merchant escrow

For each selected merchant order:

1. Browser checks Arc chain ID and the user’s ERC-20 USDC balance.
2. Browser approves the exact aggregate amount required by `OrderEscrow`.
3. Browser calls `fund` for each merchant order, or a bounded `fundBatch` helper.
4. Contract holds USDC until merchant-confirmed pickup or a valid refund path.
5. Merchant calls `markPreparing`, then `markReady`.
6. User reveals the one-time pickup code to the merchant.
7. Merchant submits the code and salt; the contract releases USDC.

The UI may collect these signatures in one approval interaction, but it must show
the exact amount, merchants, and contract address before the user signs.

## Research Budget and Decision Policy

All values are integer micro-USDC internally.

```typescript
export const RESEARCH_POLICY = {
  taskCap: 10_000n, // 0.01 USDC
  requestCap: 2_000n, // 0.002 USDC
  minAgentGasReserve: 25_000n,
  maxQuoteMerchants: 8,
  quoteTtlSeconds: 300,
} as const;
```

Budget reservation must be atomic:

1. start a database transaction;
2. lock the task budget row;
3. include pending plus settled payments;
4. reject if request or task cap would be exceeded;
5. reserve the amount with a unique idempotency key;
6. execute payment;
7. mark settled or failed and release the reservation.

The agent should not query every discovered merchant blindly. Rank candidates by
SKU coverage, distance, quality, and expected information value. Query enough
merchants to produce complete options while staying inside budget.

Suggested deterministic policy:

```text
candidateScore = 0.45 * skuCoverage
               + 0.25 * normalizedQuality
               + 0.20 * distanceScore
               + 0.10 * negotiability
```

The LLM parses intent and may explain choices. Prices, stock, distance, totals,
budget checks, option construction, and settlement decisions are deterministic.

## Signed Quotes

Every quote is signed by the merchant and verified before presentation.

The EIP-712 message must bind:

```text
quoteId
taskId
merchantId
merchantWallet
itemsHash
totalMicroUsdc
validUntil
nonce
chainId
```

`itemsHash` is a canonical hash over SKU, quantity, unit price, and line total.
A signature over only the grand total is insufficient. Nonces are single-use and
quotes expire after 300 seconds. The backend records verification status and the
recovered signer.

## Escrow Security Invariants

The contract implementation and tests must enforce:

- an order ID can be funded once;
- merchant and buyer addresses are non-zero and amount is positive;
- only the order merchant can move `Funded -> Preparing -> Ready`;
- only the merchant can submit the pickup code;
- the pickup hash is domain-separated with `orderId` and a random salt;
- the code cannot be used after the pickup deadline;
- buyer cancellation is allowed only before preparation, according to policy;
- timeout refund is allowed after the deadline;
- dispute is allowed only from an active funded state;
- terminal states cannot transition again;
- checks-effects-interactions and `SafeERC20` are used;
- no emergency release path bypasses the delivery-code requirement;
- aggregate contract liabilities are always covered by its USDC balance.

Do not copy the original `03-CONTRACTS.md` sample contract without applying these
invariants. In particular, unrestricted buyer refunds, terminal-state disputes,
and delivery-code bypasses are forbidden.

## Service Boundaries

```text
apps/web          :3000  consumer UI + merchant console
apps/agent        :3001  task state machine, AI parsing, budget, Gateway buyer
apps/merchant-api :4000  seeded merchant inventory + x402 seller endpoints
packages/shared          schemas, money, SKU, quote hashing, Arc constants
packages/contracts       OrderEscrow + tests + deployment
```

`apps/merchant-api` is a separate service. Do not hide a second unrelated server
inside `apps/agent`.

## Persistence Rules

- Database IDs are UUIDs. Human-readable merchant slugs are separate fields.
- Database `bigint` values cross JSON boundaries as decimal strings.
- Convert decimal strings to `bigint` immediately after validation.
- Never serialize JavaScript `bigint` directly.
- Store task state transitions as append-only rows, not a mutable JSON array.
- Persist SSE events before broadcasting so reconnecting clients can replay them.
- Delivery-code plaintext never reaches server-side storage. In real mode the
  shopper generates the code and salt in the browser, retains them only for the
  browser session, and funds the contract with the domain-separated hash.
- Service-role keys and wallet keys are server-only.

## SSE Reliability

Every event has a monotonically increasing sequence number. The stream endpoint:

1. replays events after `Last-Event-ID`;
2. subscribes to new persisted events;
3. sends heartbeats;
4. removes listeners on disconnect;
5. closes only on a terminal task state.

This prevents early parsing and micropayment events from being lost when the
frontend connects after task creation.

## Agent Identity

After the core flow works, register one Errand agent identity in the Arc Testnet
ERC-8004 Identity Registry. Publish metadata describing its capabilities,
research budget, supported SKUs, version, and service URL. Display the agent ID
and registration transaction in the UI and final demo.

Identity is a credibility and discoverability enhancement. It does not replace
the Gateway buyer wallet or the escrow contract.

## Definition of Done

The MVP is complete only when a recorded end-to-end run proves:

- a real Arc agent wallet and Gateway balance are visible;
- at least two merchant quote endpoints return 402 before payment;
- the agent autonomously pays both endpoints with Gateway Nanopayments;
- payment evidence and the remaining research budget appear in the UI;
- merchant data, not the LLM, determines price and stock;
- three complete options are produced or a typed insufficient-coverage error is shown;
- the user signs real Arc Testnet escrow funding;
- merchant state changes are reflected live;
- the delivery code releases real USDC to the merchant;
- explorer links prove funding and release;
- timeout/refund and invalid-code tests pass;
- no secret is present in the public repository.

## Official References

- https://docs.arc.io/llms.txt
- https://docs.arc.io/build/agentic-economy
- https://docs.arc.io/arc/references/connect-to-arc
- https://docs.arc.io/arc/references/evm-differences
- https://developers.circle.com/llms.txt
- https://developers.circle.com/gateway/nanopayments
- https://developers.circle.com/gateway/nanopayments/quickstarts/buyer
- https://developers.circle.com/gateway/nanopayments/quickstarts/seller
- https://github.com/circlefin/arc-nanopayments
- https://github.com/circlefin/arc-escrow
