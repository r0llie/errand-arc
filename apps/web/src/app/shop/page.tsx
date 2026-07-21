import Link from "next/link";
import { ShopComposer } from "./shop-composer";

export default function ShopPage() {
  const demoMode = process.env.NEXT_PUBLIC_DEMO_MODE !== "false";
  return (
    <main className="min-h-screen bg-background text-foreground">
      <header className="border-b border-border bg-background/80 backdrop-blur">
        <div className="mx-auto flex w-full max-w-6xl items-center justify-between px-6 py-5">
          <Link href="/" className="flex items-center gap-3">
            <span className="logo-mark">e</span>
            <span className="font-semibold">errand</span>
          </Link>
          <nav className="flex items-center gap-2">
            <Link href="/shop" className="button-secondary">
              Shopper
            </Link>
            <Link href="/merchant" className="button-secondary">
              Merchant console
            </Link>
          </nav>
        </div>
      </header>
      <section className="mx-auto w-full max-w-6xl px-6 py-12 sm:py-16">
        <div className="flex flex-col justify-between gap-5 md:flex-row md:items-end">
          <div className="max-w-2xl">
            <p className="eyebrow">Live two-sided demo</p>
            <h1 className="mt-6 text-4xl font-semibold tracking-[-0.045em] sm:text-5xl">
              What are you shopping for?
            </h1>
            <p className="mt-4 text-secondary">
              The local agent buys five signed quotes, compares three plans, and
              sends verified orders to the merchant console.
            </p>
          </div>
          <span className="w-fit rounded-full border border-accent/25 bg-accent-soft px-3 py-2 font-mono text-[10px] text-accent">
            {demoMode ? "LOCAL SIMULATION" : "REAL GATEWAY"} · ARC 5042002
          </span>
        </div>
        <ShopComposer />
      </section>
    </main>
  );
}
