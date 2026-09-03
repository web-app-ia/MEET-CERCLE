// ---------------------------------------------------------------------------
// JWT HS256 signé via Web Crypto (compatible Workers, aucune dépendance)
// ---------------------------------------------------------------------------

function b64urlEncode(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64urlDecodeToBytes(s: string): Uint8Array {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/");
  const pad = b64.length % 4 ? "=".repeat(4 - (b64.length % 4)) : "";
  const bin = atob(b64 + pad);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

function b64urlEncodeJson(obj: unknown): string {
  return b64urlEncode(new TextEncoder().encode(JSON.stringify(obj)));
}

export async function hmacSha256(secret: string, data: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(data));
  return new Uint8Array(sig);
}

export interface JwtClaims {
  iss?: string;
  sub?: string;
  jti?: string;
  nbf?: number;
  exp: number;
  [key: string]: unknown;
}

export async function signJwtHS256(
  secret: string,
  claims: JwtClaims,
): Promise<string> {
  const header = { alg: "HS256", typ: "JWT" };
  const signingInput = `${b64urlEncodeJson(header)}.${b64urlEncodeJson(claims)}`;
  const sig = await hmacSha256(secret, signingInput);
  return `${signingInput}.${b64urlEncode(sig)}`;
}

/** Vérifie un JWT HS256 ; retourne les claims ou null si invalide/expiré. */
export async function verifyJwtHS256(
  secret: string,
  token: string,
): Promise<JwtClaims | null> {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [h, p, sig] = parts;
  const signingInput = `${h}.${p}`;
  const expected = b64urlEncode(await hmacSha256(secret, signingInput));
  // Comparaison simple (non constant-time : suffisant pour des tokens de session)
  if (expected !== sig) return null;
  try {
    const claims = JSON.parse(new TextDecoder().decode(b64urlDecodeToBytes(p))) as JwtClaims;
    if (typeof claims.exp === "number" && claims.exp * 1000 < Date.now()) return null;
    return claims;
  } catch {
    return null;
  }
}
