"use client";

import { useState } from "react";
import { Copy, Check } from "lucide-react";

interface CopyCodeBlockProps {
  code: string;
  label?: string;
}

export function CopyCodeBlock({ code, label }: CopyCodeBlockProps) {
  const [copied, setCopied] = useState(false);

  function handleCopy() {
    navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="bg-[#1D1B16] rounded-[4px] overflow-hidden">
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-[#434343]">
        <span className="font-mono text-[8px] uppercase tracking-[0.05em] text-[#858483]">
          {label || "API Request"}
        </span>
        <button
          onClick={handleCopy}
          className="flex items-center gap-1 font-mono text-[8px] uppercase tracking-[0.05em] text-[#ADADAC] hover:text-white transition-colors px-1.5 py-0.5 rounded-[2px] hover:bg-[#434343]"
        >
          {copied ? (
            <>
              <Check className="w-2.5 h-2.5 text-[#69BE78]" />
              <span className="text-[#69BE78]">Copied</span>
            </>
          ) : (
            <>
              <Copy className="w-2.5 h-2.5" />
              Copy
            </>
          )}
        </button>
      </div>
      <pre className="px-3 py-2.5 font-mono text-[11px] leading-[16px] text-[#D8D0BF] whitespace-pre-wrap break-words overflow-x-auto max-h-[300px] overflow-y-auto">
        {code}
      </pre>
    </div>
  );
}
