import { authenticate, userPayload } from "./auth";
import { hashPin, hashPassword, isValidInvitePin } from "./security";
import { ok, fail, SubsonicError } from "./respond";
import type { Env, UserRow } from "./types";

const PIN_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_USERNAME_LENGTH = 64;
const MIN_PASSWORD_LENGTH = 8;

function jsonBody(request: Request): Promise<Record<string, unknown>> {
  return request.json().then((value) => (value && typeof value === "object" ? value as Record<string, unknown> : {}));
}

async function requireAdmin(request: Request, env: Env): Promise<UserRow> {
  const user = await authenticate(new URL(request.url), env);
  if (!user.is_admin) throw new SubsonicError(50, "Administrator access required");
  return user;
}

async function postJson(request: Request, body: Record<string, unknown>, env: Env): Promise<Response> {
  try {
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { "content-type": "application/json; charset=utf-8" },
    });
  } catch {
    return fail("1.16.1", 0, "Invalid JSON request", env);
  }
}

export async function handleSettings(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const method = request.method.toUpperCase();
  const path = url.pathname.replace(/^\/api\/settings\/?/, "").replace(/^\//, "");

  try {
    if (method === "OPTIONS") {
      return new Response(null, { status: 204, headers: { "access-control-allow-origin": "*", "access-control-allow-methods": "GET, POST, OPTIONS", "access-control-allow-headers": "content-type" } });
    }
    if (method !== "GET" && method !== "POST") throw new SubsonicError(0, "Method not allowed");

    if (path === "signup" && method === "POST") {
      const body = await jsonBody(request);
      const username = String(body.username || "").trim();
      const password = String(body.password || "");
      const passwordConfirm = String(body.passwordConfirm || "");
      const pin = String(body.pin || "").trim();

      if (!username) throw new SubsonicError(10, "Username is required");
      if (username.length > MAX_USERNAME_LENGTH) throw new SubsonicError(10, "Username is too long");
      if (password.length < MIN_PASSWORD_LENGTH) throw new SubsonicError(10, "Password must be at least 8 characters");
      if (password !== passwordConfirm) throw new SubsonicError(10, "Passwords do not match");
      if (!isValidInvitePin(pin)) throw new SubsonicError(40, "Invalid invite code");

      // Consume atomically; the transaction prevents two signups from using one PIN.
      const tx = await env.DB.transaction(async (tx) => {
        const now = new Date().toISOString();
        const consumed = await tx.prepare(
          "UPDATE setup_pins SET used_at = ? WHERE pin_hash = ? AND expires_at > ? AND used_at IS NULL"
        ).bind(now, hashPin(pin), now).run();
        if (!consumed.meta.changes) throw new SubsonicError(40, "Invite code is invalid, expired, or already used");

        const result = await tx.prepare(
          "INSERT INTO users (username, password_enc, is_admin, created_at) VALUES (?, ?, 0, ?)"
        ).bind(username, hashPassword(password), Date.now()).run();
        return { userId: Number(result.meta.last_row_id) };
      });

      return postJson(request, { ok: true, user: { username, admin: false }, signup: true }, env);
    }

    if (path === "password" && method === "POST") {
      const user = await authenticate(new URL(request.url), env);
      const body = await jsonBody(request);
      const currentPassword = String(body.currentPassword || "");
      const password = String(body.password || "");
      const passwordConfirm = String(body.passwordConfirm || "");
      if (password.length < MIN_PASSWORD_LENGTH) throw new SubsonicError(10, "Password must be at least 8 characters");
      if (password !== passwordConfirm) throw new SubsonicError(10, "Passwords do not match");

      // Reuse the existing password decoder by sending the current password as a temporary credential.
      const currentUrl = new URL(request.url);
      currentUrl.searchParams.set("p", encodeURIComponent(currentPassword));
      const current = await authenticate(currentUrl, env);
      if (current.id !== user.id) throw new SubsonicError(40, "Current password is incorrect");

      await env.DB.prepare(
        "UPDATE users SET password_enc = ? WHERE id = ?"
      ).bind(hashPassword(password), user.id).run();
      return postJson(request, { ok: true }, env);
    }

    if (path === "admin-password" && method === "POST") {
      const admin = await requireAdmin(request, env);
      const body = await jsonBody(request);
      const targetUsername = String(body.username || "").trim();
      const newPassword = String(body.newPassword || "");
      const setupSecret = String(body.setupSecret || "");
      if (!targetUsername || newPassword.length < MIN_PASSWORD_LENGTH) throw new SubsonicError(10, "Invalid reset request");
      if (hashPin(setupSecret) !== hashPin(env.SETUP_SECRET)) throw new SubsonicError(50, "Invalid administrator secret");

      const target = await env.DB.prepare("SELECT id FROM users WHERE username = ?").bind(targetUsername).first<{ id: number }>();
      if (!target) throw new SubsonicError(70, "User not found");
      await env.DB.prepare("UPDATE users SET password_enc = ? WHERE id = ?").bind(hashPassword(newPassword), target.id).run();
      await env.DB.prepare("INSERT INTO audit_events (actor_user_id, action, target, details_json, created_at) VALUES (?, ?, ?, ?, ?)").bind(admin.id, "password.reset", targetUsername, JSON.stringify({ actor: admin.username }), Date.now()).run();
      return postJson(request, { ok: true }, env);
    }

    if (path === "pins" && method === "POST") {
      const admin = await requireAdmin(request, env);
      const body = await jsonBody(request);
      const count = Number(body.count ?? 6);
      if (!Number.isInteger(count) || count < 1 || count > 6) throw new SubsonicError(10, "Generate between 1 and 6 invite codes");

      const pins: string[] = [];
      for (let i = 0; i < count; i++) {
        const pin = String(Math.floor(100000 + Math.random() * 900000));
        const now = Date.now();
        await env.DB.prepare("INSERT INTO setup_pins (pin_hash, expires_at, created_at) VALUES (?, ?, ?)").bind(hashPin(pin), now + PIN_TTL_MS, now).run();
        pins.push(pin);
      }
      await env.DB.prepare("INSERT INTO audit_events (actor_user_id, action, details_json, created_at) VALUES (?, ?, ?, ?)").bind(admin.id, "pin.generate", JSON.stringify({ count }), Date.now()).run();
      return postJson(request, { ok: true, pins }, env);
    }

    if (path === "pins" && method === "GET") {
      const admin = await requireAdmin(request, env);
      const rows = await env.DB.prepare("SELECT id, pin_hash, expires_at, used_at, created_at FROM setup_pins ORDER BY created_at DESC").all<{ id: number; pin_hash: string; expires_at: number; used_at: number | null; created_at: number }>();
      return postJson(request, { ok: true, pins: (rows.results ?? []).map((row) => ({ id: row.id, expiresAt: new Date(row.expires_at).toISOString(), createdAt: new Date(row.created_at).toISOString(), usedAt: row.used_at ? new Date(row.used_at).toISOString() : null })) }, env);
    }

    if (path === "users" && method === "GET") {
      const admin = await requireAdmin(request, env);
      const rows = await env.DB.prepare("SELECT id, username, email, is_admin, created_at FROM users ORDER BY created_at").all<UserRow>();
      return postJson(request, { ok: true, users: (rows.results ?? []).map((row) => ({ ...userPayload(row), createdAt: new Date(row.created_at).toISOString() })) }, env);
    }

    throw new SubsonicError(70, "Settings endpoint not found");
  } catch (err) {
    if (err instanceof SubsonicError) return fail("1.16.1", err.code, err.message, env);
    return fail("1.16.1", 0, err instanceof Error ? err.message : "Internal error", env);
  }
}
