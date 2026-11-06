import { existsSync } from "node:fs";
import { join } from "node:path";

import { GeistMono } from "geist/font/mono";
import { GeistSans } from "geist/font/sans";
import type { Metadata } from "next";
import type { ReactNode } from "react";

import "./globals.css";
import "../components/tearsheet.css";

export const metadata: Metadata = {
  title: "Said & Done · Parallel",
  description: "What companies promised on earnings calls, and what happened. Every statement sourced, built with the Parallel Task, Extract, Search, Image Search and Monitor APIs.",
};

// Written by scripts/copy-fonts.mjs only when the licensed brand fonts are present.
const brandFonts = existsSync(join(process.cwd(), "public/fonts/brand.css"));

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${GeistSans.variable} ${GeistMono.variable}`}>
      {/* eslint-disable-next-line @next/next/no-css-tags */}
      <head>{brandFonts ? <link rel="stylesheet" href="/fonts/brand.css" /> : null}</head>
      <body>{children}</body>
    </html>
  );
}
