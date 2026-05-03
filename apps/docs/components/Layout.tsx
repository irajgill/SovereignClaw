import Link from 'next/link';
import type { ReactNode } from 'react';

const NAV: Array<{ href: string; label: string }> = [
  { href: '/quickstart', label: 'Quickstart' },
  { href: '/architecture', label: 'Architecture' },
  { href: '/primitives/memory', label: 'Memory' },
  { href: '/primitives/mesh', label: 'Mesh' },
  { href: '/primitives/inft', label: 'iNFT' },
  { href: '/primitives/reflection', label: 'Reflection' },
  { href: '/primitives/streaming', label: 'Streaming' },
  { href: '/benchmarks', label: 'Benchmarks' },
  { href: '/security', label: 'Security' },
  { href: '/contracts', label: 'Contracts' },
];

export function Header(): JSX.Element {
  return (
    <header className="border-b border-border bg-bg/80 backdrop-blur sticky top-0 z-30">
      <div className="mx-auto max-w-7xl flex items-center gap-6 px-6 py-4">
        <Link href="/" className="font-semibold tracking-tight text-lg">
          SovereignClaw
        </Link>
        <nav className="hidden md:flex gap-5 text-sm text-muted">
          <Link href="/quickstart" className="hover:text-text">
            Docs
          </Link>
          <a
            href="https://github.com/irajgill/SovereignClaw"
            target="_blank"
            rel="noreferrer"
            className="hover:text-text"
          >
            GitHub
          </a>
          <a
            href="https://www.npmjs.com/package/@sovereignclaw/core"
            target="_blank"
            rel="noreferrer"
            className="hover:text-text"
          >
            npm
          </a>
        </nav>
        <span className="ml-auto inline-flex items-center gap-2 text-xs text-muted">
          <span className="h-2 w-2 rounded-full bg-success" />
          Live on 0G Galileo
        </span>
      </div>
    </header>
  );
}

export function Sidebar({ active }: { active?: string }): JSX.Element {
  return (
    <aside className="hidden md:block w-64 shrink-0 border-r border-border min-h-[calc(100vh-65px)]">
      <nav className="flex flex-col p-6 text-sm gap-1">
        {NAV.map((item) => {
          const isActive = active === item.href;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={
                'rounded px-3 py-2 transition-colors ' +
                (isActive
                  ? 'bg-surface-2 text-text'
                  : 'text-muted hover:bg-surface hover:text-text')
              }
            >
              {item.label}
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}

export function Footer(): JSX.Element {
  return (
    <footer className="mt-24 border-t border-border bg-surface/40">
      <div className="mx-auto max-w-7xl px-6 py-10 text-sm text-muted flex flex-wrap gap-6 justify-between">
        <div>
          <div className="font-semibold text-text mb-2">SovereignClaw</div>
          <div>Apache-2.0 licensed.</div>
          <div className="mt-1">
            Built on 0G — Storage Log, Compute Router, EVM chain, ERC-7857.
          </div>
        </div>
        <div className="flex gap-6">
          <a href="https://github.com/irajgill/SovereignClaw" className="hover:text-text">
            GitHub
          </a>
          <a href="https://www.npmjs.com/org/sovereignclaw" className="hover:text-text">
            npm
          </a>
          <a href="https://chainscan-galileo.0g.ai" className="hover:text-text">
            Chainscan
          </a>
          <a href="https://faucet.0g.ai" className="hover:text-text">
            Faucet
          </a>
        </div>
      </div>
    </footer>
  );
}

export function DocsLayout({
  children,
  active,
}: {
  children: ReactNode;
  active?: string;
}): JSX.Element {
  return (
    <>
      <Header />
      <div className="mx-auto max-w-7xl flex">
        <Sidebar active={active} />
        <main className="flex-1 px-6 py-10 md:px-10">
          <article className="prose">{children}</article>
        </main>
      </div>
      <Footer />
    </>
  );
}
