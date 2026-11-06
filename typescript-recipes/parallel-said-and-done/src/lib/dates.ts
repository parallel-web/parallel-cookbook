/** Date helpers. All dates are ISO YYYY-MM-DD and shown in UTC so server and client agree. */

const at = (iso: string) => new Date(`${iso}T12:00:00Z`);

export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  return at(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}

export function todayIso(now = new Date()): string {
  return now.toISOString().slice(0, 10);
}

export function daysBetween(fromIso: string, toIso: string): number {
  return Math.round((at(toIso).getTime() - at(fromIso).getTime()) / 86_400_000);
}

export function callStatus(callIso: string | null, today: string): { label: string; days: number | null } {
  if (!callIso) return { label: "NOT SET", days: null };
  const d = daysBetween(today, callIso);
  if (d < 0) return { label: "REPORTED", days: d };
  if (d === 0) return { label: "TODAY", days: 0 };
  return { label: `IN ${d} DAY${d === 1 ? "" : "S"}`, days: d };
}

/** Position of a date on the register track, 0–100. */
export function trackPos(iso: string, startIso: string, endIso: string): number {
  const span = at(endIso).getTime() - at(startIso).getTime();
  if (span <= 0) return 0;
  return Math.max(0, Math.min(100, ((at(iso).getTime() - at(startIso).getTime()) / span) * 100));
}
