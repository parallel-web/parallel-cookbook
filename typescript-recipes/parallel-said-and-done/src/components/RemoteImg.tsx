"use client";

import { useState, type ReactNode } from "react";

/**
 * Images found with the Image Search API are linked from their source, not
 * copied. If one fails to load, the slot shows its fallback instead.
 */
export function RemoteImg({ src, alt, fallback, className }: { src: string; alt: string; fallback?: ReactNode; className?: string }) {
  const [failed, setFailed] = useState(false);
  if (failed) return <>{fallback ?? null}</>;
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={src} alt={alt} className={className} referrerPolicy="no-referrer" loading="lazy" onError={() => setFailed(true)} />
  );
}
