import Link from "next/link";

const steps = [
  [
    "01",
    "Understands the intent",
    "Turns a plain-English request into a deterministic, validated shopping list.",
  ],
  [
    "02",
    "Pays for fresh data",
    "Spends a capped USDC research budget to request signed merchant quotes.",
  ],
  [
    "03",
    "Builds the best plans",
    "Compares price, quality, coverage, and pickup count without inventing inventory.",
  ],
  [
    "04",
    "Tracks fulfillment",
    "The shopper and every merchant see the same order state from funding to pickup.",
  ],
] as const;

export default function Home() {
  return (
    <main className="min-h-screen overflow-hidden bg-background text-foreground">
      <div className="grid-glow" />
      <header className="relative z-10 mx-auto flex w-full max-w-7xl items-center justify-between px-6 py-6 lg:px-10">
        <Link
          href="/"
          className="flex items-center gap-3"
          aria-label="Errand home"
        >
          <span className="logo-mark">e</span>
          <span className="text-lg font-semibold tracking-[-0.03em]">
            errand
          </span>
        </Link>
        <div className="flex items-center gap-3">
          <span className="hidden items-center gap-2 rounded-full border border-border bg-surface/70 px-3 py-2 text-xs text-muted sm:flex">
            <span className="h-1.5 w-1.5 rounded-full bg-success shadow-[0_0_12px_var(--success)]" />
            Local demo · Arc-ready
          </span>
          <Link href="/merchant" className="button-secondary">
            Merchant view
          </Link>
          <Link href="/shop" className="button-primary">
            Open shopper
          </Link>
        </div>
      </header>

      <section className="relative z-10 mx-auto grid min-h-[700px] w-full max-w-7xl items-center gap-14 px-6 pb-20 pt-14 lg:grid-cols-[1.08fr_0.92fr] lg:px-10 lg:pt-20">
        <div>
          <div className="eyebrow">
            <span>✦</span> Autonomous local commerce
          </div>
          <h1 className="mt-7 max-w-3xl text-5xl font-semibold leading-[0.98] tracking-[-0.065em] sm:text-6xl lg:text-[78px]">
            Say what you need.
            <span className="block text-gradient">Let the market compete.</span>
          </h1>
          <p className="mt-7 max-w-xl text-base leading-7 text-secondary sm:text-lg">
            Errand pays merchants for signed, live quotes, builds the best
            basket, and keeps shoppers and merchants synchronized through
            pickup.
          </p>
          <div className="mt-9 flex flex-col gap-3 sm:flex-row">
            <Link href="/shop" className="button-primary group">
              Run the live demo{" "}
              <span className="transition-transform group-hover:translate-x-1">
                →
              </span>
            </Link>
            <Link href="/merchant" className="button-secondary">
              Open merchant console
            </Link>
          </div>
          <div className="mt-9 flex flex-wrap gap-x-7 gap-y-3 text-xs text-muted">
            <span>✓ Signed merchant quotes</span>
            <span>✓ Budget-capped agent</span>
            <span>✓ Two-sided order flow</span>
          </div>
        </div>

        <div className="relative mx-auto w-full max-w-[520px]">
          <div className="agent-card">
            <div className="flex items-center justify-between border-b border-border px-5 py-4">
              <div className="flex items-center gap-3">
                <span className="agent-orb">✦</span>
                <div>
                  <p className="text-sm font-medium">Errand Agent</p>
                  <p className="text-xs text-muted">researching now</p>
                </div>
              </div>
              <span className="live-pill">
                <span /> LIVE
              </span>
            </div>
            <div className="space-y-3 p-5">
              <div className="request-bubble">
                “I am making meatballs for 4 people.”
              </div>
              <TimelineRow
                icon="✓"
                tone="success"
                title="8 items verified"
                detail="ground beef, onion, parsley +5"
              />
              <TimelineRow
                icon="⌖"
                tone="info"
                title="5 merchants evaluated"
                detail="coverage and quality ranked"
              />
              <TimelineRow
                icon="◈"
                tone="accent"
                title="5 signed quotes purchased"
                detail="0.0025 USDC research spend"
              />
              <div className="rounded-2xl border border-accent/30 bg-accent-soft p-4">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-accent">
                      Lowest total
                    </p>
                    <p className="mt-1 text-sm text-secondary">
                      4 pickups · verified
                    </p>
                  </div>
                  <p className="font-mono text-xl font-semibold">
                    3.00 <span className="text-xs text-secondary">USDC</span>
                  </p>
                </div>
              </div>
            </div>
          </div>
          <div className="absolute -right-8 -top-8 -z-10 h-48 w-48 rounded-full bg-accent/15 blur-3xl" />
        </div>
      </section>

      <section className="relative z-10 border-t border-border bg-surface/35">
        <div className="mx-auto w-full max-w-7xl px-6 py-20 lg:px-10">
          <p className="eyebrow w-fit">Intent → payment → pickup</p>
          <div className="mt-10 grid gap-px overflow-hidden rounded-3xl border border-border bg-border md:grid-cols-2 lg:grid-cols-4">
            {steps.map(([number, title, description]) => (
              <article key={number} className="bg-background p-6 lg:p-7">
                <p className="font-mono text-xs text-accent">{number}</p>
                <h2 className="mt-8 text-lg font-medium tracking-tight">
                  {title}
                </h2>
                <p className="mt-3 text-sm leading-6 text-secondary">
                  {description}
                </p>
              </article>
            ))}
          </div>
        </div>
      </section>
    </main>
  );
}

function TimelineRow({
  icon,
  tone,
  title,
  detail,
}: {
  icon: string;
  tone: string;
  title: string;
  detail: string;
}) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-border-subtle bg-surface/60 p-3">
      <span className={`timeline-icon ${tone}`}>{icon}</span>
      <div className="min-w-0 flex-1">
        <p className="text-sm text-foreground">{title}</p>
        <p className="mt-0.5 truncate text-xs text-muted">{detail}</p>
      </div>
    </div>
  );
}
