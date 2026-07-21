# Errand — Project Brief

## One Line

An autonomous shopping agent that spends a bounded USDC research budget to query local merchants through x402, then settles user-approved orders through escrow on Arc.

> Implementation note: `08-ARC-AGENTIC-IMPLEMENTATION.md` is the source of truth
> for Arc configuration, Gateway Nanopayments, wallet roles, and security rules.

## What It Is

Errand is a **local commerce app** where users describe what they need in plain language, and an AI agent handles everything — finding nearby shops, comparing prices, negotiating, and locking payment in on-chain escrow. The merchant releases funds when the customer picks up the order using a one-time delivery code.

Think: Yemeksepeti meets autonomous AI agents meets crypto-native payments.

## Core User Flow

1. User connects wallet (Privy)
2. User types request in plain language: _"4 kişilik köfte yapacağım"_
3. AI agent parses request → SKU list
4. Agent discovers nearby merchants (seeded data, Haversine distance)
5. Agent chooses which merchants are worth querying and pays them from its own
   Gateway balance using gasless USDC Nanopayments and standard x402
6. Agent collects signed quotes, negotiates, scores
7. Agent presents 3 options: **Cheapest / Best Quality / Pickup Route**
8. User selects an option and signs the purchase payment from their own wallet
9. USDC locked in on-chain escrow per merchant
10. User picks up order → enters delivery code → escrow releases
11. Receipt page with all tx hashes

## What Makes It Different

- Agent pays merchants autonomously for every query (real USDC micropayments on Arc)
- Every price comes from real merchant data — LLM never invents prices
- On-chain escrow with delivery code verification — trustless pickup
- Merchant admin panel — real-time order board, code verification
- Beautiful consumer app UI — not a hackathon demo, a real product

## Hackathon Track

**Agentic Economy** — autonomous AI agents that hold wallets and pay, settle and transact in USDC without a human in the loop.

## Non-Negotiables

1. Every paid agent-to-merchant query uses real Gateway USDC Nanopayments on Arc
2. LLM never generates prices/stock — all data from merchant DB
3. All prices in USDC, integer micro-USDC (6 decimals)
4. Quotes are EIP-712 signed with `validUntil` (+300s) and `nonce`
5. Research budget enforced: max 0.01 USDC total, 0.002 per request
6. Escrow releases only on delivery code verification
7. Agent research spending is autonomous; movement of user purchase funds always
   requires an explicit wallet signature
8. Every flow works on Arc Testnet with real USDC transfers and explorer evidence
