import type { Env } from "./types";

/**
 * D1 cache-first lyrics storage:
 * Free-tier safe: Only reads from D1; no external API calls in the default implementation.
 * Add provider integration later behind explicit secrets and bounded timeouts.
 */

export interface LyricsResult {
  plain: string | null;
  synced: string | null; // raw LRC text, e.g. "[00:12.34]Some line"
  source: string;
}

export interface LyricsLine {
  start: number | null; // ms, null for unsynced lines
  value: string;
}

export async function getLyricsFromDatabase(env: Env, trackId: number): Promise<LyricsResult | null> {
  const row = await env.DB.prepare("SELECT plain, synced FROM lyrics WHERE track_id = ?").bind(trackId).first<{ plain: string | null; synced: string | null }>();
  if (!row) return null;
  return { plain: row.plain, synced: row.synced, source: "d1-cache" };
}

export async function cacheLyrics(env: Env, trackId: number, plain: string | null, synced: string | null): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO lyrics (track_id, plain, synced, source, fetched_at) VALUES (?, ?, ?, 'cache', ?)
     ON CONFLICT(track_id) DO UPDATE SET plain=excluded.plain, synced=excluded.synced, fetched_at=excluded.fetched_at`
  ).bind(trackId, plain ?? "", synced ?? "", Date.now()).run();
}

export async function getCachedLyricsResult(env: Env, trackId: number): Promise<LyricsResult | null> {
  return await getLyricsFromDatabase(env, trackId);
}

export async function getOrFetchLyrics(
  env: Env,
  trackId: number,
  artist: string,
  title: string,
  album?: string,
  duration?: number,
): Promise<LyricsResult | null> {
  // Free-tier safe: only reads from D1 cache; no external API calls.
  const cached = await getLyricsFromDatabase(env, trackId);
  if (cached) return cached;

  // TODO: Add external provider (lrclib, genius) behind explicit secrets
  // and strict request-timeout guards. For now return null so the frontend
  // shows a "lyrics unavailable" state.
  return { plain: null, synced: null, source: "none" };
}

export function parseLrc(lrc: string): LyricsLine[] {
  const lineRe = /^\[(\d+):(\d+(?:\.\d+)?)\](.*)$/;
  const lines: LyricsLine[] = [];
  for (const raw of lrc.split(/\r?\n/)) {
    const m = lineRe.exec(raw.trim());
    if (!m) continue;
    const minutes = parseInt(m[1], 10);
    const seconds = parseFloat(m[2]);
    const start = Math.round((minutes * 60 + seconds) * 1000);
    const value = m[3].trim();
    if (value) lines.push({ start, value });
  }
  return lines;
}