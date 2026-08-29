const API_BASE = (process.env.NEXT_PUBLIC_API_BASE ?? "").replace(/\/$/, "")

export function api(path: string): string {
  return `${API_BASE}${path}`
}
