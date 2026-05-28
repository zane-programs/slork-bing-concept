import {
  CONDUCTOR_TOKENS_STORAGE_KEY,
  MEMBER_TOKENS_STORAGE_KEY,
  SOCKET_URL_BASE,
} from "../constants";

export type AuthRole = "member" | "conductor";

interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

const ACCESS_SKEW_MS = 60_000;
const REFRESH_MIN_REMAINING_MS = 60_000;

function storageKey(role: AuthRole): string {
  return role === "conductor"
    ? CONDUCTOR_TOKENS_STORAGE_KEY
    : MEMBER_TOKENS_STORAGE_KEY;
}

function readPair(role: AuthRole): TokenPair | null {
  try {
    const raw = localStorage.getItem(storageKey(role));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<TokenPair>;
    if (!parsed?.accessToken || !parsed?.refreshToken) return null;
    return { accessToken: parsed.accessToken, refreshToken: parsed.refreshToken };
  } catch {
    return null;
  }
}

function writePair(role: AuthRole, pair: TokenPair): void {
  try {
    localStorage.setItem(storageKey(role), JSON.stringify(pair));
  } catch {
    // storage full or disabled (shouldn't happen in practice)
  }
}

export function clearAuth(role: AuthRole): void {
  try {
    localStorage.removeItem(storageKey(role));
  } catch {
    // ignore
  }
}

/** decode the exp claim without verification. browsers don't need to trust the token. */
function decodeExpiryMs(token: string): number | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  try {
    // base64url → base64
    const b64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const padded = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
    const payload = JSON.parse(atob(padded)) as { exp?: number };
    if (typeof payload.exp !== "number") return null;
    return payload.exp * 1000;
  } catch {
    return null;
  }
}

function isLive(token: string, skewMs: number): boolean {
  const expMs = decodeExpiryMs(token);
  if (expMs === null) return false;
  return expMs - Date.now() > skewMs;
}

function httpBase(): string {
  return SOCKET_URL_BASE.replace(/^ws/, "http");
}

interface AuthError {
  kind: "passcode" | "network";
}

export type LoginResult = { ok: true } | { ok: false; error: AuthError };

/** exchange a passcode for a stored token pair. */
export async function loginWithPasscode(
  role: AuthRole,
  passcode: string,
): Promise<LoginResult> {
  const endpoint = role === "conductor" ? "/auth/conductor" : "/auth/member";
  let res: Response;
  try {
    res = await fetch(httpBase() + endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ passcode }),
    });
  } catch {
    return { ok: false, error: { kind: "network" } };
  }
  if (!res.ok) {
    return { ok: false, error: { kind: "passcode" } };
  }
  const data = (await res.json().catch(() => ({}))) as Partial<TokenPair> & {
    ok?: boolean;
  };
  if (!data.ok || !data.accessToken || !data.refreshToken) {
    return { ok: false, error: { kind: "passcode" } };
  }
  writePair(role, {
    accessToken: data.accessToken,
    refreshToken: data.refreshToken,
  });
  return { ok: true };
}

async function refresh(role: AuthRole): Promise<TokenPair | null> {
  const stored = readPair(role);
  if (!stored) return null;
  if (!isLive(stored.refreshToken, REFRESH_MIN_REMAINING_MS)) {
    clearAuth(role);
    return null;
  }
  let res: Response;
  try {
    res = await fetch(httpBase() + "/auth/refresh", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ refreshToken: stored.refreshToken }),
    });
  } catch {
    return null;
  }
  if (!res.ok) {
    // 401 => needa refresh
    if (res.status === 401) clearAuth(role);
    return null;
  }
  const data = (await res.json().catch(() => ({}))) as Partial<TokenPair> & {
    ok?: boolean;
  };
  if (!data.ok || !data.accessToken || !data.refreshToken) return null;
  const next: TokenPair = {
    accessToken: data.accessToken,
    refreshToken: data.refreshToken,
  };
  writePair(role, next);
  return next;
}

// for deduping inflight refreshes
const inflightRefresh = new Map<AuthRole, Promise<TokenPair | null>>();

function refreshDeduped(role: AuthRole): Promise<TokenPair | null> {
  const existing = inflightRefresh.get(role);
  if (existing) return existing;
  const p = refresh(role).finally(() => inflightRefresh.delete(role));
  inflightRefresh.set(role, p);
  return p;
}

export async function getAccessToken(role: AuthRole): Promise<string | null> {
  const stored = readPair(role);
  if (!stored) return null;
  if (isLive(stored.accessToken, ACCESS_SKEW_MS)) return stored.accessToken;
  const refreshed = await refreshDeduped(role);
  return refreshed ? refreshed.accessToken : null;
}

export function hasUsableSession(role: AuthRole): boolean {
  const stored = readPair(role);
  if (!stored) return false;
  return isLive(stored.refreshToken, REFRESH_MIN_REMAINING_MS);
}
