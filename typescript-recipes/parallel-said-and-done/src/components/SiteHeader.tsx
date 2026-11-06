import Link from "next/link";

import { SOURCE_URL } from "../lib/site";

export function SiteHeader() {
  return (
    <header className="site-header no-print">
      <div className="wrap">
        <Link href="/" className="brand" aria-label="Said and Done, by Parallel">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/parallel-wordmark.svg" alt="Parallel" />
          <span className="brand-divider" />
          <span className="brand-name">Said &amp; Done</span>
        </Link>
        <nav className="site-nav" aria-label="Main">
          <a href={SOURCE_URL} target="_blank" rel="noreferrer">
            Source code ↗
          </a>
        </nav>
      </div>
    </header>
  );
}

export const DISCLAIMER = "Not investment advice. Generated from Parallel Task, Search and Extract output; no figures entered by hand.";

export function SiteFooter({ asOf }: { asOf?: string | null }) {
  return (
    <footer className="site-footer no-print">
      <div className="wrap">
        <div className="foot">
        <span>
          {asOf ? `${asOf} · ` : ""}
          {DISCLAIMER}
        </span>
        <span className="powered">
          <span>Powered by</span>
          <span className="powered-pill">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/parallel-lockup-light.svg" alt="Parallel" />
          </span>
        </span>
        </div>
      </div>
    </footer>
  );
}
