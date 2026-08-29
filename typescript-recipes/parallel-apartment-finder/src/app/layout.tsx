import type { Metadata } from "next"
import "./globals.css"
import "leaflet/dist/leaflet.css"
import { ConfigProvider } from "@/providers/config-provider"
import { buildAppConfig } from "@/lib/server/app-config"

const TITLE = "Bay Area Apartment Finder"
const DESCRIPTION = "Find your Bay Area rental in your own words. AI-powered apartment search with cited sources."

export const metadata: Metadata = {
  metadataBase: new URL("https://apartment-finder-web.vercel.app"),
  title: TITLE,
  description: DESCRIPTION,
  openGraph: {
    title: TITLE,
    description: DESCRIPTION,
    siteName: "Apartment Finder",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: TITLE,
    description: DESCRIPTION,
  },
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <body>
        {/* Map tiles come from cartocdn's a/b/c shards; warm the connections
            so the first map open skips DNS+TLS setup. */}
        <link rel="preconnect" href="https://a.basemaps.cartocdn.com" />
        <link rel="preconnect" href="https://b.basemaps.cartocdn.com" />
        <link rel="preconnect" href="https://c.basemaps.cartocdn.com" />
        <ConfigProvider config={buildAppConfig()}>
          {children}
        </ConfigProvider>
      </body>
    </html>
  )
}
