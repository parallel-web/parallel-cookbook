import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Company Enrichment | Parallel + Supabase",
  description: "Enrich company data using Parallel Task API and Supabase",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}
