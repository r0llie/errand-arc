# Errand — Hackathon Submission Pack

## One-line pitch

Errand is an autonomous local-commerce agent that pays merchants in USDC for trusted inventory and quotes, compares the results under a strict spending policy, and settles the chosen pickup order through Arc escrow.

## Why this belongs in the Agentic Economy track

The agent is an economic actor, not a chat wrapper. It:

1. converts intent into deterministic product SKUs;
2. ranks merchants from real coverage, quality, distance, and negotiability signals;
3. chooses which paid APIs are worth querying;
4. reserves and spends its own bounded Gateway USDC budget without per-call approval;
5. verifies EIP-712 merchant quotes independently;
6. constructs three deterministic shopping plans;
7. asks for a user signature only when purchase funds will move;
8. monitors merchant preparation and pickup settlement.

## Arc and Circle stack

| Product              | Use                                                                   |
| -------------------- | --------------------------------------------------------------------- |
| Arc Testnet          | USDC-native chain for Gateway deposits, merchant payments, and escrow |
| USDC                 | Agent research budget and order settlement asset                      |
| Gateway Nanopayments | Gasless sub-cent buyer authorizations and batched merchant settlement |
| x402                 | HTTP-native `402 → signed payment → 200` negotiation                  |
| EIP-712              | Merchant quote integrity and signer recovery                          |
| Solidity escrow      | Conditional pickup settlement and timeout refunds                     |

## Runtime architecture

```text
Shopper UI (:3000) ───────┐
                          ├─> Agent API (:3001)
Merchant UI (:3000) ──────┘       │
                                  │ ranks + reserves budget
                                  │ GatewayClient.pay()
                                  ▼
                          Merchant API (:4000)
                          402 Gateway middleware
                                  │
                                  ▼
                         Circle Gateway / Arc Testnet

Selected basket: shopper wallet → OrderEscrow → merchant on pickup
```

## Verified evidence ledger

| Evidence                                 | Status                                    | Proof                                                                   |
| ---------------------------------------- | ----------------------------------------- | ----------------------------------------------------------------------- |
| Agent wallet funded                      | Verified                                  | `0xDD2E55714966c9093483d769847Dda5b4a956138`                            |
| Gateway deposit                          | Verified                                  | `0x7baebfaeb9a5ce463d83e4c8a4bf503d333ccb5741ddf464c09f0ac0a55887f7`    |
| Gateway approval                         | Verified                                  | `0xea13ec3ad1902059f7181976353eada09880b2f021f57c5646ac7f3467992b42`    |
| Gateway balance before paid run          | Verified                                  | `1 USDC`                                                                |
| Gateway balance after approved paid run  | Verified                                  | `0.9975 USDC` — exactly `0.0025 USDC` spent                             |
| Two merchant endpoints return unpaid 402 | Verified locally                          | Arc `eip155:5042002`, `500` micro-USDC, distinct payees                 |
| Full two-sided local browser loop        | Verified                                  | 5 quote receipts, 3 plans, 4 orders, all completed, no console errors   |
| Escrow security tests                    | Verified locally                          | 5/5 Hardhat tests passing                                               |
| Real x402 seller/buyer round trips       | Verified for Ali, Can, and Cem            | Three signed quotes, recovered EIP-712 signers, and seller receipt IDs  |
| First two paid-call failure diagnosis    | Fixed and regression-tested               | Duplicate-case Content-Type caused Express to receive an undefined body |
| OrderEscrow Arc deployment               | Verified                                  | `0x40a97F02cBA40C9DcB6fc6845384C65FFA971749`                            |
| Can Butcher transaction-gas funding      | Verified                                  | Exactly `0.1 USDC`; recipient balance `0 → 0.1`                         |
| Browser wallet escrow integration        | Implemented and tested locally            | Arc chain/account checks, approve, fund, merchant lifecycle, event sync |
| Escrow lifecycle transaction preview     | Verified read-only                        | 1.5 USDC principal; maximum 0.02 USDC gas; fixed unused order ID        |
| Real escrow fund/release                 | Pending explicit transaction confirmation | Add funding and release tx links here                                   |

Explorer links:

- Gateway deposit: https://testnet.arcscan.app/tx/0x7baebfaeb9a5ce463d83e4c8a4bf503d333ccb5741ddf464c09f0ac0a55887f7
- Gateway approval: https://testnet.arcscan.app/tx/0xea13ec3ad1902059f7181976353eada09880b2f021f57c5646ac7f3467992b42
- OrderEscrow deployment: https://testnet.arcscan.app/tx/0x1683858658fd3530febe92265df526bf0daa155466bef4842282622f86597246
- OrderEscrow contract: https://testnet.arcscan.app/address/0x40a97F02cBA40C9DcB6fc6845384C65FFA971749
- Can Butcher gas funding: https://testnet.arcscan.app/tx/0x981efb71b9f30056099159be20b7c8de33416e9ad2cd39c8cd20b88c74904d73

Successful Gateway settlement IDs from the corrected paid path:

- Ali Butcher: `aa2f60d7-2157-450b-88b7-7437643a843f`
- Can Butcher: `6e32621d-c6dc-4dd8-87e8-013ded590920`
- Cem Bakery: `48912613-f2bf-481c-a162-45b47da36841`

The first Mini Market and Zeynep calls consumed the remaining `0.001 USDC` but their business handlers returned `400` after settlement because two differently-cased Content-Type headers were combined. The code now lets `GatewayClient` set this header exactly once and includes a regression test. The final recorded run should repeat those two corrected calls only after a new explicit `0.001 USDC` approval.

## Local demo script

1. Run `pnpm install`, `pnpm demo:wallets`, and `pnpm dev`.
2. Open `http://localhost:3000/shop` and `http://localhost:3000/merchant`.
3. Submit “I am making meatballs for 4 people.”
4. Show the scored merchant policy, 0.0025 USDC research spend, and 0.0075 USDC remaining task budget.
5. Show five independently verified signed quotes and three shopping plans.
6. Choose “Lowest total” and create four demo pickup orders.
7. In the merchant tab, show the five x402 receipts and advance every order.
8. Return to the shopper tab and show the completed event timeline.

## Real Gateway demo script

1. Set `DEMO_MODE=false` and restart the agent and merchant services.
2. Call `POST /research/preview` and show five validated live 402 requirements.
3. Show the agent's 1 USDC Gateway balance and 0.01 USDC task cap.
4. Start the same shopping task.
5. Show five real `GatewayClient.pay()` settlements at 0.0005 USDC each.
6. Show the agent and merchant receipt views plus the reduced Gateway balance.

## Real escrow demo script

1. Run `pnpm --filter @errand/contracts demo:preview` and verify the exact accounts, contract, principal, and gas cap before approving any transaction.
2. Deploy `OrderEscrow`, set `ESCROW_CONTRACT_ADDRESS`, and restart in real mode.
3. Select a plan. Show that orders begin at `awaiting_funding`; no purchase funds moved during agent research.
4. Connect the shopper wallet on Arc Testnet and approve/fund one basket.
5. Show the verified `OrderFunded` event and Arcscan link on both sides.
6. Connect the exact merchant wallet and submit `markPreparing`, then `markReady`.
7. Copy the shopper-only pickup proof into the merchant console and submit `confirmPickup`.
8. Show `OrderCompleted`, the merchant USDC release, and the final explorer evidence.

## Three-minute video outline

- **0:00–0:25 — Problem:** local inventory is fragmented and agents cannot trust or freely query every merchant.
- **0:25–0:50 — Product:** Errand turns one intent into a bounded autonomous research mission.
- **0:50–1:35 — Live agent:** show signal scores, paid x402 calls, signed quotes, remaining budget, and three plans.
- **1:35–2:10 — Merchant side:** show API revenue and the pickup workflow.
- **2:10–2:35 — Arc:** show Gateway deposit/payment evidence and escrow contract transactions in Arcscan.
- **2:35–3:00 — Business:** sell the orchestration layer to delivery, mobility, procurement, and marketplace operators; charge SaaS plus per-agent transaction fees.

## Checkpoint 2 progress summary

Errand now has a public monorepo, an English two-sided demo, deterministic merchant selection from real signals, bounded/idempotent research spending, Circle Gateway x402 seller and buyer integrations, independently verified EIP-712 merchant quotes, live buyer/merchant payment evidence, and a tested Arc Testnet pickup escrow contract. The Gateway buyer completed the approved `0.0025 USDC` proof run, the corrected path returned three signed quotes, and the deployed escrow is ready for a recorded fund-to-release transaction.

## Final submission checklist

- [x] Public repository
- [x] English shopper and merchant demo
- [x] Autonomous signal-based merchant selection
- [x] Bounded research policy and budget ledger
- [x] Gateway buyer funded on Arc Testnet
- [x] Multiple x402-protected merchant endpoints
- [x] Signed quote verification
- [x] Secure escrow contract and tests
- [x] Record first real paid x402 run and add settlement proof
- [x] Deploy `OrderEscrow` to Arc Testnet
- [x] Connect shopper wallet to exact approval/funding calls
- [x] Connect merchant wallet to preparation, ready, and pickup release calls
- [x] Keep pickup code and salt out of merchant/server responses
- [ ] Record real fund → ready → pickup → release flow
- [ ] Deploy public HTTPS services
- [ ] Record three-minute pitch/demo video
- [ ] Create final deck
- [ ] Submit final project before the deadline
