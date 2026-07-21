import Link from "next/link";
import { MerchantConsole } from "./merchant-console";

export default function MerchantPage() {
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
        <div className="max-w-2xl">
          <p className="eyebrow">Merchant operations</p>
          <h1 className="mt-6 text-4xl font-semibold tracking-[-0.045em] sm:text-5xl">
            Incoming pickup orders
          </h1>
          <p className="mt-4 text-secondary">
            This view polls the same agent state as the shopper. Accept,
            prepare, and complete each funded order here.
          </p>
        </div>
        <MerchantConsole />
      </section>
    </main>
  );
}
