import { decodeSubsonicPassword, decryptSecret, md5Hex } from "./crypto";
import { SubsonicError } from "./respond";
import type { Env, UserRow } from "./types";

export async function authenticate(url: URL, env: Env): Promise<UserRow> {
  if (!env.AUTH_SECRET) {
    throw new SubsonicError(0, "AUTH_SECRET is not set on this Worker");
  }

  const apiKey = url.searchParams.get("apiKey");
  if (apiKey) {
    const row = await env.DB.prepare("SELECT * FROM users WHERE api_key = ?").bind(apiKey).first<UserRow>();
    if (!row) throw new SubsonicError(44, "Invalid API key");
    return row;
  }

  const username = url.searchParams.get("u");
  if (!username) throw new SubsonicError(10, "Required parameter missing: u");

  const row = await env.DB.prepare("SELECT * FROM users WHERE username = ?").bind(username).first<UserRow>();
  if (!row) throw new SubsonicError(40, "Wrong username or password");

  let password: string;
  try {
    password = await decryptSecret(row.password_enc, env.AUTH_SECRET);
  } catch {
    throw new SubsonicError(0, "Unable to decrypt stored password — check AUTH_SECRET");
  }

  const token = url.searchParams.get("t");
  const salt = url.searchParams.get("s");
  const p = url.searchParams.get("p");

  if (token && salt) {
    if (md5Hex(password + salt) !== token.toLowerCase()) {
      throw new SubsonicError(40, "Wrong username or password");
    }
    return row;
  }

  if (p) {
    if (decodeSubsonicPassword(p) !== password) {
      throw new SubsonicError(40, "Wrong username or password");
    }
    return row;
  }

  throw new SubsonicError(10, "Required parameter missing: p or t/s or apiKey");
}

export function userPayload(row: UserRow) {
  return {
    username: row.username,
    email: row.email || `${row.username}@vazo.local`,
    scrobblingEnabled: true,
    adminRole: row.is_admin === 1,
    settingsRole: row.is_admin === 1,
    downloadRole: true,
    uploadRole: row.is_admin === 1,
    playlistRole: true,
    coverArtRole: row.is_admin === 1,
    commentRole: false,
    podcastRole: false,
    streamRole: true,
    jukeboxRole: false,
    shareRole: false,
    videoConversionRole: false,
    folder: [1],
  };
}
