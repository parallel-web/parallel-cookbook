// Demo access key handling. The passphrase the user enters at the gate is
// kept in localStorage and attached to every /api request in the x-demo-key
// header. The backend enforces it — this file is plumbing, not the boundary.

const KEY = "pse-access-key";

export function getAccessKey(): string | null {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

export function setAccessKey(value: string): void {
  try {
    localStorage.setItem(KEY, value);
  } catch {
    /* storage blocked — the key just won't persist across reloads */
  }
}

export function clearAccessKey(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}
