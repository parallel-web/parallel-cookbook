"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { KeyRound, LogOut, User } from "lucide-react";

export function AccountMenu({
  displayName,
  email,
}: {
  displayName: string | null;
  email: string | null;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onPointer(event: MouseEvent) {
      if (ref.current && !ref.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onPointer);
    return () => document.removeEventListener("mousedown", onPointer);
  }, []);

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    window.location.href = "/signin";
  }

  const label = displayName || email || "Account";

  return (
    <div className="account-menu-wrap" ref={ref}>
      <button
        type="button"
        className="account-menu-button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
      >
        <User size={14} />
        <span>{label}</span>
      </button>
      {open ? (
        <div className="account-menu">
          {email ? <div className="account-menu-meta">{email}</div> : null}
          <Link href="/settings/keys" onClick={() => setOpen(false)}>
            <KeyRound size={14} />
            API keys
          </Link>
          <button type="button" onClick={logout}>
            <LogOut size={14} />
            Sign out
          </button>
        </div>
      ) : null}
    </div>
  );
}
