import jwt, { type SignOptions, type VerifyOptions } from "jsonwebtoken";

export type TokenRole = "member" | "conductor";
type TokenType = "access" | "refresh";

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

export interface VerifiedClaim {
  role: TokenRole;
}

// 24h access / 30d refresh
const ACCESS_TTL_SEC = 24 * 60 * 60;
const REFRESH_TTL_SEC = 30 * 24 * 60 * 60;

const JWT_SECRET = (() => {
  const fromEnv = process.env.JWT_SECRET;
  if (fromEnv && fromEnv.length > 0) return fromEnv;
  console.warn(
    "[auth] WARN - JWT_SECRET not set, using dev falback key"
  );
  return "slork-dev-default-rotate-me-before-prod";
})();

const SIGN_OPTS: SignOptions = { algorithm: "HS256" };
const VERIFY_OPTS: VerifyOptions = { algorithms: ["HS256"] };

function isTokenRole(v: unknown): v is TokenRole {
  return v === "member" || v === "conductor";
}

function sign(role: TokenRole, typ: TokenType, ttlSec: number): string {
  return jwt.sign({ role, typ }, JWT_SECRET, {
    ...SIGN_OPTS,
    expiresIn: ttlSec,
  });
}

function verify(token: string, expectedType: TokenType): VerifiedClaim | null {
  try {
    const decoded = jwt.verify(token, JWT_SECRET, VERIFY_OPTS);
    if (typeof decoded !== "object" || decoded === null) return null;
    const { role, typ } = decoded as { role?: unknown; typ?: unknown };
    if (typ !== expectedType) return null;
    if (!isTokenRole(role)) return null;
    return { role };
  } catch {
    return null;
  }
}

export function mintPair(role: TokenRole): TokenPair {
  return {
    accessToken: sign(role, "access", ACCESS_TTL_SEC),
    refreshToken: sign(role, "refresh", REFRESH_TTL_SEC),
  };
}

export function verifyAccess(token: string | undefined): VerifiedClaim | null {
  if (!token || typeof token !== "string") return null;
  return verify(token, "access");
}

export function verifyRefresh(token: string | undefined): VerifiedClaim | null {
  if (!token || typeof token !== "string") return null;
  return verify(token, "refresh");
}
