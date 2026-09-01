// ---------------------------------------------------------------------------
// Client API Hetzner Cloud (minimal, orienté cycle de vie SFU éphémère)
// Docs : https://docs.hetzner.cloud/
//
// Politique réseau (devis V4) :
//  - ipv6_only   : enable_ipv4 = false  → Primary IPv6 gratuite uniquement
//  - dual_stack  : enable_ipv4 = true   → compatibilité maximale (IPv4 payante)
//  - ipv6_plus_turn : identique à ipv6_only (la compatibilité est assurée
//    par le TURN mutualisé, pas par une IPv4 par serveur)
// ---------------------------------------------------------------------------

import type { Env } from "./config";
import type { HetznerServer } from "./types";

const API = "https://api.hetzner.cloud/v1";

export interface CreateServerOptions {
  name: string;
  serverType: string;
  location: string;
  image: string;
  enableIpv4: boolean;
  userData: string;
  labels: Record<string, string>;
}

async function hetznerFetch(
  env: Env,
  path: string,
  init?: RequestInit & { timeoutMs?: number },
): Promise<Response> {
  if (!env.HETZNER_API_TOKEN) {
    throw new Error("HETZNER_API_TOKEN non configuré (npx wrangler secret put HETZNER_API_TOKEN)");
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), init?.timeoutMs ?? 30000);
  try {
    return await fetch(`${API}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${env.HETZNER_API_TOKEN}`,
        "Content-Type": "application/json",
        ...(init?.headers ?? {}),
      },
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

export interface HetznerError extends Error {
  status?: number;
  body?: unknown;
}

function hetznerError(status: number, body: unknown): HetznerError {
  const msg =
    body && typeof body === "object" && "error" in (body as Record<string, unknown>)
      ? JSON.stringify((body as Record<string, unknown>).error)
      : `HTTP ${status}`;
  const err = new Error(`Hetzner API: ${msg}`) as HetznerError;
  err.status = status;
  err.body = body;
  return err;
}

/**
 * Crée le serveur SFU. Idempotence à la charge de l'appelant (verrou dans
 * le RoomDO). Le user_data (cloud-init) configure LiveKit + mTLS éventuel.
 */
export async function createSfuServer(
  env: Env,
  opts: CreateServerOptions,
): Promise<HetznerServer> {
  const res = await hetznerFetch(env, "/servers", {
    method: "POST",
    body: JSON.stringify({
      name: opts.name,
      server_type: opts.serverType,
      location: opts.location,
      image: opts.image,
      start_after_create: true,
      user_data: opts.userData,
      labels: opts.labels,
      public_net: {
        enable_ipv6: true,
        enable_ipv4: opts.enableIpv4,
      },
      // Pas de réseau privé : le SFU est une instance jetable.
    }),
  });
  if (!res.ok) throw hetznerError(res.status, await res.json().catch(() => null));
  const json = (await res.json()) as { server: HetznerServer };
  return json.server;
}

export async function getServer(env: Env, id: number): Promise<HetznerServer | null> {
  const res = await hetznerFetch(env, `/servers/${id}`);
  if (res.status === 404) return null;
  if (!res.ok) throw hetznerError(res.status, await res.json().catch(() => null));
  const json = (await res.json()) as { server: HetznerServer };
  return json.server;
}

/** Attend que le serveur atteigne l'état voulu (poll borné). */
export async function waitForServerStatus(
  env: Env,
  id: number,
  target: string,
  timeoutMs = 120000,
  intervalMs = 5000,
): Promise<HetznerServer> {
  const deadline = Date.now() + timeoutMs;
  let last: HetznerServer | null = null;
  while (Date.now() < deadline) {
    last = await getServer(env, id);
    if (last?.status === target) return last;
    if (last && (last.status === "error" || last.status === "deleting")) {
      throw new Error(`Serveur Hetzner ${id} en état ${last.status}`);
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error(`Timeout : serveur Hetzner ${id} jamais passé en « ${target} »`);
}

/**
 * Suppression définitive (arrête la facturation). Retourne true si
 * supprimé ou déjà inexistant — idempotent.
 */
export async function deleteServer(env: Env, id: number): Promise<boolean> {
  const res = await hetznerFetch(env, `/servers/${id}`, { method: "DELETE" });
  if (res.status === 404) return true;
  if (!res.ok) throw hetznerError(res.status, await res.json().catch(() => null));
  return true;
}

/** Liste les SFU actifs par label (utilisé par le sweep de sécurité). */
export async function listSfuServers(env: Env): Promise<HetznerServer[]> {
  const res = await hetznerFetch(env, "/servers?label_selector=app%3Dmeet-cercle");
  if (!res.ok) throw hetznerError(res.status, await res.json().catch(() => null));
  const json = (await res.json()) as { servers: HetznerServer[] };
  return json.servers;
}

/** Rend le cloud-init pour ce SFU (voir infra/cloud-init-livekit.yaml). */
export function renderCloudInit(params: {
  domain: string;
  livekitKeys: { key: string; secret: string };
  region: string;
  nodeIp: string;
  enableLivekitTurn: boolean;
  turnSecret?: string;
  corsOrigins: string[];
}): string {
  const turnBlock = params.enableLivekitTurn
    ? `turn:
  enabled: true
  tls_port: 5349
  udp_port: 3478
  domain: ${params.domain}
${params.turnSecret ? `  secret: ${params.turnSecret}\n` : ""}`
    : `turn:
  enabled: false`;
  const nodeIpFlag = params.nodeIp ? ` --node-ip=${params.nodeIp}` : "";
  return `#cloud-config
# Généré automatiquement par l'orchestrateur MEET-CERCLE — ne pas éditer.
package_update: true
packages: [ca-certificates, curl, dnsutils]

runcmd:
  # Installeur officiel LiveKit (binaire + service systemd de base)
  - curl -sSL https://get.livekit.io/install | bash
  - systemctl disable livekit-server 2>/dev/null || true
  - |
    cat > /etc/livekit/livekit.yaml <<'YAML'
    port: 7880
    bind_addresses:
      - "::"
    rtc:
      tcp_port: 7881
      port_range_start: 50000
      port_range_end: 50200
      use_external_ip: true
    region: ${params.region}
    keys:
      ${params.livekitKeys.key}: ${params.livekitKeys.secret}
    ${turnBlock}
    YAML
  - |
    cat > /etc/systemd/system/livekit-server.service <<'UNIT'
    [Unit]
    Description=LiveKit SFU (éphémère MEET-CERCLE)
    After=network-online.target
    Wants=network-online.target

    [Service]
    ExecStart=/usr/bin/livekit-server --config /etc/livekit/livekit.yaml${nodeIpFlag}
    Restart=always
    RestartSec=3
    LimitNOFILE=65535

    [Install]
    WantedBy=multi-user.target
    UNIT
  - systemctl daemon-reload
  - systemctl enable --now livekit-server
`;
}
