// ---------------------------------------------------------------------------
// DNS Cloudflare : création/suppression à chaud des records des SFU éphémères
// Le host <sfu-id>.SFU_DOMAIN doit pointer vers l'IPv6 (AAAA) du serveur
// Hetzner ; un record A n'est ajouté qu'en politique dual_stack.
// Nécessite CF_DNS_TOKEN (Zone:DNS:Edit) + CF_ZONE_ID.
// ---------------------------------------------------------------------------

import type { Env } from "./config";

const API = "https://api.cloudflare.com/client/v4";

async function cfFetch(
  env: Env,
  path: string,
  init?: RequestInit,
): Promise<{ ok: boolean; status: number; json: any }> {
  if (!env.CF_DNS_TOKEN || !env.CF_ZONE_ID) {
    throw new Error("CF_DNS_TOKEN / CF_ZONE_ID non configurés (secrets wrangler)");
  }
  const res = await fetch(`${API}/zones/${env.CF_ZONE_ID}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${env.CF_DNS_TOKEN}`,
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  const json: any = await res.json().catch(() => null);
  return { ok: res.ok && !!json?.success, status: res.status, json };
}

export interface DnsRecord {
  id: string;
  type: string;
  name: string;
  content: string;
}

export async function createDnsRecord(
  env: Env,
  params: { name: string; type: "A" | "AAAA"; content: string; ttl?: number },
): Promise<DnsRecord> {
  const { json } = await cfFetch(env, "/dns_records", {
    method: "POST",
    body: JSON.stringify({
      type: params.type,
      name: params.name,
      content: params.content,
      ttl: params.ttl ?? 120,
      proxied: false, // record gris : obligatoire pour Let's Encrypt + WebRTC direct
    }),
  });
  if (!json?.success) {
    throw new Error(`Création DNS ${params.type} ${params.name} échouée: ${JSON.stringify(json?.errors ?? json)}`);
  }
  return json.result as DnsRecord;
}

export async function deleteDnsRecord(env: Env, id: string): Promise<boolean> {
  const { status } = await cfFetch(env, `/dns_records/${id}`, { method: "DELETE" });
  return status === 200 || status === 404; // idempotent
}
