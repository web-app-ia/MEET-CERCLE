// ---------------------------------------------------------------------------
// JWT HS256 signé via Web Crypto (compatible Workers, aucune dépendance)
// ---------------------------------------------------------------------------

function b64urlEncode(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64urlEncodeJson(obj: unknown): string {
  return b64urlEncode(new TextEncoder().encode(JSON.stringify(obj)));
}

async function hmacSha256(secret: string, data: string): Promise<Uint8Array> {
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
