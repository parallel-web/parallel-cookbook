"use client";

import { Mail } from "lucide-react";

interface HeaderProps {
  monitorCount: number;
  detectedCount: number;
  lastChecked: string;
  onOpenBrief: () => void;
}

export function Header({
  monitorCount,
  detectedCount,
  lastChecked,
  onOpenBrief,
}: HeaderProps) {
  return (
    <header className="flex items-center justify-between px-6 py-2.5 border-b border-[#E5E5E5] bg-white shrink-0">
      <div className="flex items-center gap-3">
        <h1 className="text-[16px] font-medium text-[#1D1B16]">
          Datacenter Monitor
        </h1>
        <div className="flex items-center gap-2 text-[13px] font-mono text-[#858483]">
          <span className="inline-block w-2 h-2 rounded-full bg-[#69BE78]" />
          <span className="text-[#1D1B16]">{monitorCount} monitors</span>
          <span>&middot;</span>
          {detectedCount > 0 ? (
            <span className="text-[#FB631B]">
              {detectedCount} event{detectedCount !== 1 ? "s" : ""} detected
            </span>
          ) : (
            <span>no events yet</span>
          )}
          <span>&middot;</span>
          {/* Server and client clocks differ on this text node */}
          <span suppressHydrationWarning>updated {lastChecked}</span>
        </div>
      </div>

      <div className="flex items-center gap-3">
        <button
          onClick={onOpenBrief}
          className="inline-flex items-center gap-[7px] border border-[#E5E5E5] rounded-[5px] px-[11px] py-[6px] cursor-pointer hover:border-[#FB631B] hover:text-[#FB631B] transition-colors"
        >
          <Mail className="w-[13px] h-[13px] text-[#FB631B]" />
          <span className="font-mono text-[11px] text-[#181818]">Weekly brief</span>
        </button>

        <a
          href="https://parallel.ai"
          target="_blank"
          rel="noopener noreferrer"
          className="font-mono text-[13px] text-[#858483] border border-[#E5E5E5] rounded-[4px] px-3 py-1 hover:border-[#FB631B] hover:text-[#FB631B] transition-colors"
        >
          Powered by parallel.ai
        </a>
      </div>
    </header>
  );
}
