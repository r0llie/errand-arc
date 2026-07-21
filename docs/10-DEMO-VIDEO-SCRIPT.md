# Errand — Three-Minute Demo Script

## 0:00–0:20 — Problem

“Local commerce is still opaque to autonomous agents. Listings can be stale, prices are hard to verify, and an agent has no native way to pay a merchant for a fresh answer and carry that trust into settlement. Errand turns that gap into a paid, verifiable commerce loop.”

Show slide 2, then switch to the shopper app.

## 0:20–0:55 — Intent and decision policy

“The shopper gives Errand one intent: ‘I am making meatballs for four people.’ The agent converts that request into product SKUs and ranks local merchants from explicit signals: 45 percent coverage, 25 percent quality, 20 percent distance, and 10 percent negotiability. This is deterministic decision logic, not an opaque recommendation.”

Show the merchant score breakdown and the 0.01 USDC research cap.

## 0:55–1:25 — Autonomous paid research

“Before it spends, Errand validates each merchant’s live x402 requirement: Arc Testnet, USDC, exact payee, and 0.0005 USDC price. It reserves budget atomically, then its Circle Gateway wallet buys the selected quotes without asking for a signature on every request.”

Show the live 402 preview, task timeline, and Gateway balance change.

## 1:25–1:50 — Quote verification and planning

“Every response is independently verified. Errand recovers the merchant’s EIP-712 signer and checks the basket hash, total, nonce, expiry, and item math. It then produces three explainable plans, including lowest total and best quality.”

Show the verified quote receipts and plan comparison.

## 1:50–2:25 — Two-sided Arc settlement

“Research payments and purchase money are separate. The selected basket starts at awaiting funding. The shopper approves and funds OrderEscrow on Arc. On the merchant side, the exact merchant wallet marks the order preparing and ready. The pickup secret stays with the shopper; only the correct proof releases USDC to the merchant.”

Show shopper and merchant tabs side by side, then the fund, ready, and pickup transaction links.

## 2:25–2:43 — Evidence

“This is a working testnet MVP: 0.0025 USDC spent through x402, three corrected paid quote round trips with signed responses, 23 automated tests passing, and OrderEscrow deployed on Arc Testnet.”

Open the deployed contract and the final lifecycle transaction on Arcscan.

## 2:43–3:00 — Business and close

“Errand starts with local pickup procurement, then becomes an agent-commerce layer for delivery, mobility, field service, and B2B purchasing. Operators can embed the SDK and pay SaaS plus per-agent transaction fees. Agents can buy locally. Now they can prove it.”

End on slide 8 with the public repository and `https://errand-arc.vercel.app` visible in the video description.
