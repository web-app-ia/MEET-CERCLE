// ---------------------------------------------------------------------------
// AccountDO — état d'un compte abonné (un DO par compte, clé = e-mail
// normalisé via idFromName). Le modèle mono-thread du DO garantit l'atomicité
// du verrou anti-partage (une seule réunion active / compte).
//
// Stockage (Cloudflare Durable Object storage) :
//   - account        : profil + mot de passe haché (sel+SHA-256)
//   - activeRoomId   : salon verrouillé en cours (null = aucun)
//
// La gestion des forfaits reste dans le frontend (abonnement localStorage) pour
// l'instant ; ce DO gère l'identité et le verrou. Le `planId` est conservé
// ici pour une bascule future côté serveur.
// ---------------------------------------------------------------------------

import type { Env } from "./config";

interface Account {
  accountId: string;
  email: string;
  name: string;
  salt: string;
  pwhash: string;
  planId: string; // "free" | "pass" | "mensuel" | "annuel"
  planExpiry: number; // ms epoch ; 0 si illimité/gratuit
  activeRoomId: string | null;
}

function bufToHex(buf: ArrayBuffer): string {
  const b = new Uint8Array(buf);
  let s = "";
  for (let i = 0; i < b.length; i++) s += b[i].toString(16).padStart(2, "0");
  return s;
}

async function hashPassword(password: string, salt: string): Promise<string> {
  const data = new TextEncoder().encode(`${salt}:${password}`);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return bufToHex(digest);
}

function newSalt(): string {
  const b = crypto.getRandomValues(new Uint8Array(16));
  return bufToHex(b.buffer);
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

function jsonError(message: string, status = 400): Response {
  return json({ error: message }, status);
}

function publicAccount(a: Account) {
  return {
    accountId: a.accountId,
    email: a.email,
    name: a.name,
    planId: a.planId,
    planExpiry: a.planExpiry,
    activeRoomId: a.activeRoomId,
  };
}

export class AccountDO implements DurableObject {
  private email: string;

  constructor(
    private ctx: DurableObjectState,
    private env: Env,
  ) {
    this.email = ctx.id.name ?? "unknown";
  }

  private async load(): Promise<Account | null> {
    return (await this.ctx.storage.get<Account>("account")) ?? null;
  }

  private async save(a: Account): Promise<void> {
    await this.ctx.storage.put("account", a);
  }

  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);
    const path = url.pathname;

    if (req.method === "POST" && path === "/register") return this.handleRegister(req);
    if (req.method === "POST" && path === "/login") return this.handleLogin(req);
    if (req.method === "GET" && path === "/me") return this.handleMe();
    if (req.method === "POST" && path === "/lock") return this.handleLock(req);
    if (req.method === "POST" && path === "/unlock") return this.handleUnlock(req);

    return new Response("Not found in AccountDO", { status: 404 });
  }

  private async handleRegister(req: Request): Promise<Response> {
    const body = (await req.json().catch(() => ({}))) as {
      email?: string;
      password?: string;
      name?: string;
    };
    const email = (body.email || "").trim().toLowerCase();
    const password = body.password || "";
    const name = (body.name || "").trim().slice(0, 80) || email.split("@")[0];

    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      return jsonError("E-mail invalide", 400);
    }
    if (password.length < 6) {
      return jsonError("Mot de passe trop court (6 caractères minimum)", 400);
    }

    const existing = await this.load();
    if (existing) return jsonError("Un compte existe déjà pour cet e-mail", 409);

    const salt = newSalt();
    const account: Account = {
      accountId: crypto.randomUUID(),
      email,
      name,
      salt,
      pwhash: await hashPassword(password, salt),
      planId: "free",
      planExpiry: 0,
      activeRoomId: null,
    };
    await this.save(account);
    return json({ account: publicAccount(account) }, 201);
  }

  private async handleLogin(req: Request): Promise<Response> {
    const body = (await req.json().catch(() => ({}))) as { password?: string };
    const account = await this.load();
    if (!account) return jsonError("Compte introuvable", 404);
    const password = body.password || "";
    const hash = await hashPassword(password, account.salt);
    if (hash !== account.pwhash) return jsonError("Mot de passe incorrect", 401);
    return json({ account: publicAccount(account) });
  }

  private async handleMe(): Promise<Response> {
    const account = await this.load();
    if (!account) return jsonError("Compte introuvable", 404);
    return json({ account: publicAccount(account) });
  }

  /**
   * Verrouille une réunion pour ce compte. Règle anti-partage : si une autre
   * réunion est déjà verrouillée, on refuse (409). Idempotent si c'est la même.
   */
  private async handleLock(req: Request): Promise<Response> {
    const body = (await req.json().catch(() => ({}))) as { roomId?: string };
    const roomId = (body.roomId || "").trim();
    if (!roomId) return jsonError("roomId requis", 400);

    const account = await this.load();
    if (!account) return jsonError("Compte introuvable", 404);

    if (account.activeRoomId && account.activeRoomId !== roomId) {
      return json(
        { ok: false, reason: "already_in_meeting", activeRoomId: account.activeRoomId },
        409,
      );
    }

    account.activeRoomId = roomId;
    await this.save(account);
    // Index global : permet au Worker/MiroTalk de libérer le verrou par roomId
    // quand le salon se vide (libération même si l'onglet est fermé).
    await this.env.STATE.put(`roomOwner:${roomId}`, this.email);

    return json({ ok: true, activeRoomId: roomId });
  }

  private async handleUnlock(req: Request): Promise<Response> {
    const body = (await req.json().catch(() => ({}))) as { roomId?: string };
    const roomId = (body.roomId || "").trim();
    if (!roomId) return jsonError("roomId requis", 400);

    const account = await this.load();
    if (account && account.activeRoomId === roomId) {
      account.activeRoomId = null;
      await this.save(account);
    }
    await this.env.STATE.delete(`roomOwner:${roomId}`).catch(() => undefined);
    return json({ ok: true });
  }
}
