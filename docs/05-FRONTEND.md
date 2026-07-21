# Errand — Frontend

> Wallet and payment behavior follows `08-ARC-AGENTIC-IMPLEMENTATION.md`.

## Overview

Next.js 15 App Router, React 19, Tailwind v4, Framer Motion.
Two main experiences: **User App** and **Merchant Console**.

---

## Design Language

### Vibe

Clean, modern, fintech meets local commerce. Think Revolut meets a farmers market.
Dark mode first. Accent: warm amber/orange (market feel) on deep navy/slate.

### Colors (globals.css tokens)

```css
:root {
  --background: #0a0f1e;
  --surface: #111827;
  --surface-elevated: #1a2235;
  --border: #1e293b;
  --border-subtle: #0f172a;

  --accent: #f59e0b; /* amber — primary CTA */
  --accent-hover: #d97706;
  --accent-subtle: #78350f20;

  --success: #10b981; /* emerald — completed, funded */
  --warning: #f59e0b; /* amber — pending, waiting */
  --error: #ef4444; /* red — failed, refunded */
  --info: #6366f1; /* indigo — agent thinking */

  --text-primary: #f8fafc;
  --text-secondary: #94a3b8;
  --text-muted: #475569;

  --radius-sm: 8px;
  --radius-md: 12px;
  --radius-lg: 16px;
  --radius-xl: 24px;
}
```

### Typography

- Headlines: `font-semibold` tracking tight
- Body: `font-normal` slate-300
- Numbers/prices: `font-mono` for USDC amounts
- Turkish UI text, English for technical labels

---

## Pages & Routes

### `/` — Landing

```
Hero: "Mahalle alışverişi, AI ajanınız sayesinde"
Subtext: "Ne almak istediğinizi söyleyin, gerisini biz halledelim"
CTA: "Alışverişe Başla" → /shop
Small: wallet connect widget (Privy)
Background: subtle grid pattern, floating merchant cards animation
```

### `/shop` — Main App

This is the core experience. Full-page layout.

**Layout:**

```
┌─────────────────────────────────┐
│  [Logo]           [Wallet/Balance] │
├─────────────────────────────────┤
│                                 │
│  [Prompt Input]                 │
│  "Ne almak istiyorsunuz?"       │
│  [Örnek: 4 kişilik köfte...]    │
│                                 │
├─────────────────────────────────┤
│  [Agent Timeline - SSE stream]  │
│  ● Parsing...                   │
│  ● 5 esnaf bulundu              │
│  ● Ali Kasap'a sorgulandı 💰    │
│  ● Teklifler toplandı           │
├─────────────────────────────────┤
│  [Option Cards - 3 columns]     │
│  En Ucuz | En Kaliteli | Rota   │
│                                 │
│  [Selected Option Detail]       │
│  [Approve Button]               │
└─────────────────────────────────┘
```

**Components:**

#### `<PromptInput />`

```tsx
// Large textarea with:
// - Placeholder: "4 kişilik köfte yapacağım..."
// - Suggestion chips below: ["Köfte malzemeleri", "Kahvaltı için...", "Izgara partisi"]
// - Send button (animated when typing)
// - Character counter
// - Disabled while agent is running
```

#### `<AgentTimeline />`

```tsx
// SSE-driven live feed
// Each event = one row, animated in with Framer Motion
// Event types have icons:
//   status → spinning loader or checkmark
//   merchant_discovered → 🏪 with distance badge
//   micropayment → 💸 with USDC amount + tx link
//   quote_received → 📋 merchant name + total
//   error → ❌ red

// Example row:
// 💸  Ali Kasap'a sorgu ücreti ödendi  +$0.0005  [0x1234...] ↗
// 📋  Ali Kasap teklif verdi  $18.40  ✓ imzalı
```

#### `<MerchantDiscoveryCard />`

```tsx
// Animated card sliding in as merchants are discovered
// Shows:
//   - Merchant name + category emoji (🥩 kasap, 🥬 manav, 🍞 fırın, 🏪 market)
//   - Distance badge (172m • 2 dk yürüyüş)
//   - Quality score stars
//   - "Sorgulanıyor..." → "Teklif Alındı ✓" state transition
```

#### `<OptionCard />`

```tsx
// Three cards side by side (or stacked mobile)
// Each card:
//   - Type badge: "EN UCUZ" | "EN KALİTELİ" | "GEL-AL ROTASI"
//   - Total price (big, mono font): $24.50
//   - Merchant list with item breakdown
//   - Estimated pickup time
//   - TTL countdown on quotes (expires in 4:32)
//   - Select button

// Selected state: amber border, checkmark, expanded detail
```

#### `<PaymentApproval />`

```tsx
// Appears after option selected
// Shows:
//   - Selected option summary
//   - Agent research spend: $0.0032 (paid from the agent budget, informational)
//   - Escrow amount: $24.50 (to lock)
//   - User signs: $24.50 plus Arc gas (never silently add agent research spend)
//   - Per-merchant breakdown
//   - "Onayla ve Öde" CTA → triggers escrow funding
//   - Privy transaction signature UI
```

#### `<EscrowStatus />`

```tsx
// After approval — shows per-merchant escrow
// Timeline: Funded → Preparing → Ready → Released
// Live updates via SSE
// Each step has timestamp
// "Teslim Kodu" appears when Ready
```

### `/orders` — Active Orders

```
List of active tasks with status
Click → /shop?taskId=xxx to resume
```

### `/receipt/[taskId]` — Receipt

```
Full breakdown:
  - Task summary (prompt, date)
  - Research costs itemized (every micropayment)
  - Per-merchant orders + escrow tx hashes
  - Total spent
  - Star rating + tag feedback (Taze, Hızlı, Uygun Fiyat, etc.)
  - "Paylaş" button
  - On-chain links (Arc Testnet explorer)
```

### `/merchant` — Merchant Console

```
Separate experience for merchants.
Auth: Merchant selects their shop from dropdown (demo mode) or connects wallet.

Layout:
┌────────────────────────────┐
│ [Merchant Name] Dashboard  │
├────────────────────────────┤
│ Active Orders  Completed   │
│ ─────────────────────────  │
│ [OrderCard]                │
│   Items: 500g kıyma        │
│   Amount: $9.00 in escrow  │
│   Status: ● Funded         │
│   [Hazırlamaya Başla] btn  │
│                            │
│ [OrderCard - Preparing]    │
│   Status: ● Preparing      │
│   [Hazır İşaretle] btn     │
│                            │
│ [OrderCard - Ready]        │
│   Status: ● Ready          │
│   [Teslim Kodu Gir] input  │
│   [Doğrula] → releases $   │
└────────────────────────────┘
```

#### `<MerchantOrderCard />`

```tsx
// Shows order details
// Action buttons change based on status:
//   Funded → "Hazırlamaya Başla"
//   Preparing → "Hazır İşaretle" + estimated ready time input
//   Ready → delivery code input + "Doğrula"
// Real-time updates via Supabase realtime subscription
// Escrow release shows tx hash + success animation 🎉
```

---

## Key UX Details

### Micro-interactions

- Every USDC micropayment → subtle coin flip animation + amount badge
- Merchant cards slide in from right as discovered
- Option cards flip in with 150ms stagger
- Escrow release → confetti burst (canvas-confetti)
- Error states → shake animation

### Loading States

- Agent thinking → animated dots + "AI ajan düşünüyor..." text
- Quote pending → skeleton card with shimmer
- Tx pending → spinning Arc logo

### Mobile

- Prompt takes full screen initially
- Timeline scrolls up, options appear below
- Bottom sheet for payment approval
- Merchant console works on phone (merchants will use it in shop)

---

## State Management

Use Zustand for global state:

```typescript
interface ErrandStore {
  // Wallet
  walletAddress: string | null;
  usdcBalance: bigint;

  // Active task
  taskId: string | null;
  taskStatus: TaskStatus;
  events: AgentEvent[];
  skus: SKUItem[];
  options: ShoppingOption[];
  selectedOption: ShoppingOption | null;
  orders: Order[];

  // Actions
  startTask: (prompt: string) => Promise<void>;
  selectOption: (type: string) => Promise<void>;
  approvePayment: () => Promise<void>; // get plan, sign in Privy, report tx hashes
  cancelTask: () => Promise<void>;
}
```

---

## SSE Hook

```typescript
// hooks/useAgentStream.ts
export function useAgentStream(taskId: string | null) {
  const addEvent = useErrandStore((s) => s.addEvent);

  useEffect(() => {
    if (!taskId) return;

    const es = new EventSource(`http://localhost:3001/tasks/${taskId}/stream`);

    es.onmessage = (e) => {
      const event = JSON.parse(e.data) as AgentEvent;
      addEvent(event);
    };

    return () => es.close();
  }, [taskId]);
}
```

---

## Privy Integration

```typescript
// app/providers.tsx
import { PrivyProvider } from '@privy-io/react-auth'

export function Providers({ children }) {
  return (
    <PrivyProvider
      appId={process.env.NEXT_PUBLIC_PRIVY_APP_ID!}
      config={{
        loginMethods: ['email', 'wallet'],
        appearance: {
          theme: 'dark',
          accentColor: '#f59e0b',
        },
        embeddedWallets: {
          createOnLogin: 'users-without-wallets',
        },
      }}
    >
      {children}
    </PrivyProvider>
  )
}
```

---

## Demo Suggestions (on landing / prompt input)

```typescript
export const DEMO_PROMPTS = [
  "4 kişilik köfte yapacağım, malzemeleri alacağım",
  "Pazar kahvaltısı için alışveriş yapacağım, 6 kişiyiz",
  "Izgara partisi hazırlığı, 8 kişilik et ve sebze",
  "Mercimek çorbası için malzemeler lazım",
  "Mangal için kömür ve et almam gerekiyor",
];
```
