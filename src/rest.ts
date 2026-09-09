import { authenticate, userPayload } from "./auth";
import {
  albumById,
  albumList,
  albumPayload,
  albumsByArtist,
  allArtists,
  artistById,
  artistPayload,
  findTrackByArtistTitle,
  getStarSet,
  searchAlbums,
  searchArtists,
  searchTracks,
  similarTracks,
  songPayload,
  trackById,
  tracksByAlbum,
} from "./catalog";
import { albumId, artistId, FOLDER_ID, iso, parseId, playlistId, trackId } from "./ids";
import { getOrFetchLyrics, parseLrc } from "./lyrics";
import { handleBinary } from "./media";
import { fail, formatOf, ok, SubsonicError } from "./respond";
import type { Env, TrackRow, UserRow } from "./types";

function intParam(url: URL, name: string, fallback: number): number {
  const v = url.searchParams.get(name);
  if (v === null || v === "") return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function str(url: URL, name: string): string | null {
  return url.searchParams.get(name);
}

function indexLetter(name: string): string {
  const c = name.replace(/^(the|a|an)\s+/i, "").charAt(0).toUpperCase();
  return /[A-Z]/.test(c) ? c : "#";
}

async function withStars(env: Env, user: UserRow, tracks: TrackRow[]) {
  const stars = await getStarSet(env, user.id, "song");
  return tracks.map((t) => songPayload(t, stars.has(t.id) ? Date.now() : t.starred_at));
}

async function handleMethod(request: Request, env: Env, method: string, url: URL): Promise<Response> {
  const fmt = formatOf(url);

  // Authenticate before doing anything else — including binary responses and
  // ping/capability checks — so no endpoint can be reached without valid credentials.
  const user = await authenticate(url, env);

  if (method === "ping") return ok(env, fmt);
  if (method === "getopensubsonicextensions") {
    return ok(env, fmt, {
      openSubsonicExtensions: [
        { name: "apiKeyAuthentication", versions: [1] },
        { name: "formPost", versions: [1] },
      ],
    });
  }

  const binary = await handleBinary(request, env, method, url);
  if (binary) return binary;

  switch (method) {
    case "getlicense":
      return ok(env, fmt, {
        license: { valid: true, email: user.email || `${user.username}@vazo.local` },
      });

    case "getuser":
      return ok(env, fmt, { user: userPayload(user) });

    case "getusers": {
      if (!user.is_admin) throw new SubsonicError(50, "Not authorized");
      const { results } = await env.DB.prepare("SELECT * FROM users").all<UserRow>();
      return ok(env, fmt, { users: { user: (results ?? []).map(userPayload) } });
    }

    case "getmusicfolders":
      return ok(env, fmt, {
        musicFolders: { musicFolder: [{ id: 1, name: env.MUSIC_FOLDER_NAME || "Music" }] },
      });

    case "getindexes": {
      const artists = await allArtists(env);
      const groups = new Map<string, ReturnType<typeof artistPayload>[]>();
      for (const a of artists) {
        const letter = indexLetter(a.name);
        const list = groups.get(letter) ?? [];
        list.push(artistPayload(a));
        groups.set(letter, list);
      }
      return ok(env, fmt, {
        indexes: {
          lastModified: Date.now(),
          ignoredArticles: "The El La Los Las Le Les",
          index: [...groups.entries()].map(([name, artist]) => ({ name, artist })),
        },
      });
    }

    case "getartists": {
      const artists = await allArtists(env);
      const groups = new Map<string, ReturnType<typeof artistPayload>[]>();
      for (const a of artists) {
        const letter = indexLetter(a.name);
        const list = groups.get(letter) ?? [];
        list.push(artistPayload(a));
        groups.set(letter, list);
      }
      return ok(env, fmt, {
        artists: {
          ignoredArticles: "The El La Los Las Le Les",
          index: [...groups.entries()].map(([name, artist]) => ({ name, artist })),
        },
      });
    }

    case "getartist": {
      const id = parseId(str(url, "id"));
      if (!id || id.kind !== "ar") throw new SubsonicError(70, "Artist not found");
      const artist = await artistById(env, id.n);
      if (!artist) throw new SubsonicError(70, "Artist not found");
      const albums = await albumsByArtist(env, artist.id);
      const stars = await getStarSet(env, user.id, "album");
      return ok(env, fmt, {
        artist: {
          ...artistPayload(artist),
          album: albums.map((a) => albumPayload(a, { starred: stars.has(a.id) ? iso(Date.now()) : undefined })),
        },
      });
    }

    case "getalbum": {
      const id = parseId(str(url, "id"));
      if (!id || id.kind !== "al") throw new SubsonicError(70, "Album not found");
      const album = await albumById(env, id.n);
      if (!album) throw new SubsonicError(70, "Album not found");
      const tracks = await tracksByAlbum(env, album.id);
      return ok(env, fmt, {
        album: { ...albumPayload(album), song: await withStars(env, user, tracks) },
      });
    }

    case "getsong": {
      const id = parseId(str(url, "id"));
      if (!id || id.kind !== "tr") throw new SubsonicError(70, "Song not found");
      const track = await trackById(env, id.n);
      if (!track) throw new SubsonicError(70, "Song not found");
      const [song] = await withStars(env, user, [track]);
      return ok(env, fmt, { song });
    }

    case "getmusicdirectory": {
      const raw = str(url, "id") || FOLDER_ID;
      if (raw === FOLDER_ID || raw === "1") {
        const artists = await allArtists(env);
        return ok(env, fmt, {
          directory: {
            id: FOLDER_ID,
            name: env.MUSIC_FOLDER_NAME || "Music",
            child: artists.map((a) => ({
              id: artistId(a.id),
              parent: FOLDER_ID,
              isDir: true,
              title: a.name,
              artist: a.name,
              coverArt: artistId(a.id),
            })),
          },
        });
      }
      const id = parseId(raw);
      if (id?.kind === "ar") {
        const artist = await artistById(env, id.n);
        if (!artist) throw new SubsonicError(70, "Not found");
        const albums = await albumsByArtist(env, artist.id);
        return ok(env, fmt, {
          directory: {
            id: artistId(artist.id),
            parent: FOLDER_ID,
            name: artist.name,
            child: albums.map((a) => ({
              id: albumId(a.id),
              parent: artistId(artist.id),
              isDir: true,
              title: a.name,
              album: a.name,
              artist: a.artist_name,
              coverArt: albumId(a.id),
              year: a.year ?? undefined,
            })),
          },
        });
      }
      if (id?.kind === "al") {
        const album = await albumById(env, id.n);
        if (!album) throw new SubsonicError(70, "Not found");
        const tracks = await tracksByAlbum(env, album.id);
        return ok(env, fmt, {
          directory: {
            id: albumId(album.id),
            parent: artistId(album.artist_id),
            name: album.name,
            child: await withStars(env, user, tracks),
          },
        });
      }
      throw new SubsonicError(70, "Not found");
    }

    case "getalbumlist":
    case "getalbumlist2": {
      const type = str(url, "type") || "newest";
      const albums = await albumList(env, type, intParam(url, "size", 20), intParam(url, "offset", 0), {
        fromYear: intParam(url, "fromYear", 0) || undefined,
        toYear: intParam(url, "toYear", 0) || undefined,
        genre: str(url, "genre") || undefined,
        user,
      });
      const key = method === "getalbumlist2" ? "albumList2" : "albumList";
      const childKey = method === "getalbumlist2" ? "album" : "album";
      if (method === "getalbumlist") {
        return ok(env, fmt, {
          [key]: {
            [childKey]: albums.map((a) => ({
              id: albumId(a.id),
              parent: artistId(a.artist_id),
              isDir: true,
              title: a.name,
              name: a.name,
              album: a.name,
              artist: a.artist_name,
              artistId: artistId(a.artist_id),
              coverArt: albumId(a.id),
              songCount: a.song_count ?? 0,
              duration: a.duration_sec ?? 0,
              playCount: a.play_count ?? 0,
              created: iso(a.created_at),
              year: a.year ?? undefined,
              genre: a.genre ?? undefined,
            })),
          },
        });
      }
      return ok(env, fmt, { [key]: { album: albums.map((a) => albumPayload(a)) } });
    }

    case "getgenres": {
      const { results } = await env.DB.prepare(
        `SELECT genre AS value, COUNT(DISTINCT album_id) AS albumCount, COUNT(*) AS songCount
         FROM tracks WHERE genre IS NOT NULL AND genre != '' GROUP BY genre ORDER BY genre`,
      ).all<{ value: string; albumCount: number; songCount: number }>();
      return ok(env, fmt, { genres: { genre: results ?? [] } });
    }

    case "getsongsbygenre": {
      const genre = str(url, "genre");
      if (!genre) throw new SubsonicError(10, "Required parameter missing: genre");
      const { results } = await env.DB.prepare(
        `SELECT t.*, al.name AS album_name, ar.name AS artist_name
         FROM tracks t JOIN albums al ON al.id = t.album_id JOIN artists ar ON ar.id = t.artist_id
         WHERE t.genre = ? ORDER BY ar.name, al.name, t.track_no LIMIT ? OFFSET ?`,
      )
        .bind(genre, intParam(url, "count", 10), intParam(url, "offset", 0))
        .all<TrackRow>();
      return ok(env, fmt, { songsByGenre: { song: await withStars(env, user, results ?? []) } });
    }

    case "getrandomsongs": {
      const { results } = await env.DB.prepare(
        `SELECT t.*, al.name AS album_name, ar.name AS artist_name
         FROM tracks t JOIN albums al ON al.id = t.album_id JOIN artists ar ON ar.id = t.artist_id
         ORDER BY RANDOM() LIMIT ?`,
      )
        .bind(intParam(url, "size", 10))
        .all<TrackRow>();
      return ok(env, fmt, { randomSongs: { song: await withStars(env, user, results ?? []) } });
    }

    case "search2":
    case "search3": {
      const q = str(url, "query") || "";
      const artists = await searchArtists(env, q, intParam(url, "artistCount", 20), intParam(url, "artistOffset", 0));
      const albums = await searchAlbums(env, q, intParam(url, "albumCount", 20), intParam(url, "albumOffset", 0));
      const tracks = await searchTracks(env, q, intParam(url, "songCount", 20), intParam(url, "songOffset", 0));
      const key = method === "search3" ? "searchResult3" : "searchResult2";
      return ok(env, fmt, {
        [key]: {
          artist: artists.map(artistPayload),
          album: albums.map((a) => albumPayload(a)),
          song: await withStars(env, user, tracks),
        },
      });
    }

    case "getsimilarsongs":
    case "getsimilarsongs2": {
      const id = parseId(str(url, "id"));
      if (!id) throw new SubsonicError(10, "Required parameter missing: id");
      let seed: TrackRow | null = null;
      if (id.kind === "tr") seed = await trackById(env, id.n);
      else if (id.kind === "al") {
        const tracks = await tracksByAlbum(env, id.n);
        seed = tracks[0] ?? null;
      } else if (id.kind === "ar") {
        const { results } = await env.DB.prepare(
          `SELECT t.*, al.name AS album_name, ar.name AS artist_name
           FROM tracks t JOIN albums al ON al.id = t.album_id JOIN artists ar ON ar.id = t.artist_id
           WHERE t.artist_id = ? LIMIT 1`,
        )
          .bind(id.n)
          .all<TrackRow>();
        seed = results?.[0] ?? null;
      }
      if (!seed) throw new SubsonicError(70, "Not found");
      const similar = await similarTracks(env, seed, intParam(url, "count", 50));
      const key = method === "getsimilarsongs2" ? "similarSongs2" : "similarSongs";
      return ok(env, fmt, { [key]: { song: await withStars(env, user, similar) } });
    }

    case "getplaylists": {
      const { results } = await env.DB.prepare(
        `SELECT p.*, (SELECT COUNT(*) FROM playlist_tracks pt WHERE pt.playlist_id = p.id) AS songCount
         FROM playlists p WHERE p.user_id = ? OR p.public = 1 ORDER BY p.name`,
      )
        .bind(user.id)
        .all<{ id: number; user_id: number; name: string; comment: string | null; public: number; created_at: number; changed_at: number; songCount: number }>();
      const owner = await env.DB.prepare("SELECT username FROM users WHERE id = ?");
      const list = [];
      for (const p of results ?? []) {
        const u = p.user_id === user.id ? user.username : (await owner.bind(p.user_id).first<{ username: string }>())?.username;
        list.push({
          id: playlistId(p.id),
          name: p.name,
          comment: p.comment ?? undefined,
          owner: u,
          public: p.public === 1,
          songCount: p.songCount,
          created: iso(p.created_at),
          changed: iso(p.changed_at),
          coverArt: playlistId(p.id),
        });
      }
      return ok(env, fmt, { playlists: { playlist: list } });
    }

    case "getplaylist": {
      const id = parseId(str(url, "id"));
      if (!id || id.kind !== "pl") throw new SubsonicError(70, "Playlist not found");
      const p = await env.DB.prepare("SELECT * FROM playlists WHERE id = ?").bind(id.n).first<{
        id: number;
        user_id: number;
        name: string;
        comment: string | null;
        public: number;
        created_at: number;
        changed_at: number;
      }>();
      if (!p || (p.user_id !== user.id && !p.public)) throw new SubsonicError(70, "Playlist not found");
      const { results } = await env.DB.prepare(
        `SELECT t.*, al.name AS album_name, ar.name AS artist_name
         FROM playlist_tracks pt
         JOIN tracks t ON t.id = pt.track_id
         JOIN albums al ON al.id = t.album_id
         JOIN artists ar ON ar.id = t.artist_id
         WHERE pt.playlist_id = ? ORDER BY pt.position`,
      )
        .bind(p.id)
        .all<TrackRow>();
      const owner = await env.DB.prepare("SELECT username FROM users WHERE id = ?").bind(p.user_id).first<{ username: string }>();
      return ok(env, fmt, {
        playlist: {
          id: playlistId(p.id),
          name: p.name,
          comment: p.comment ?? undefined,
          owner: owner?.username,
          public: p.public === 1,
          songCount: (results ?? []).length,
          created: iso(p.created_at),
          changed: iso(p.changed_at),
          coverArt: playlistId(p.id),
          entry: await withStars(env, user, results ?? []),
        },
      });
    }

    case "createplaylist": {
      const name = str(url, "name");
      const existing = parseId(str(url, "playlistId"));
      const songIds = url.searchParams.getAll("songId");
      let playlistDbId: number;
      const t = Date.now();
      if (existing?.kind === "pl") {
        const p = await env.DB.prepare("SELECT * FROM playlists WHERE id = ? AND user_id = ?")
          .bind(existing.n, user.id)
          .first();
        if (!p) throw new SubsonicError(70, "Playlist not found");
        playlistDbId = existing.n;
        if (name) await env.DB.prepare("UPDATE playlists SET name = ?, changed_at = ? WHERE id = ?").bind(name, t, playlistDbId).run();
        await env.DB.prepare("DELETE FROM playlist_tracks WHERE playlist_id = ?").bind(playlistDbId).run();
      } else {
        if (!name) throw new SubsonicError(10, "Required parameter missing: name");
        const res = await env.DB.prepare(
          "INSERT INTO playlists (user_id, name, public, created_at, changed_at) VALUES (?, ?, 0, ?, ?)",
        )
          .bind(user.id, name, t, t)
          .run();
        playlistDbId = Number(res.meta.last_row_id);
      }
      let pos = 0;
      for (const sid of songIds) {
        const parsed = parseId(sid);
        if (parsed?.kind === "tr") {
          await env.DB.prepare("INSERT INTO playlist_tracks (playlist_id, track_id, position) VALUES (?, ?, ?)").bind(
            playlistDbId,
            parsed.n,
            pos++,
          ).run();
        }
      }
      url.searchParams.set("id", playlistId(playlistDbId));
      return handleMethod(request, env, "getplaylist", url);
    }

    case "updateplaylist": {
      const id = parseId(str(url, "playlistId"));
      if (!id || id.kind !== "pl") throw new SubsonicError(10, "Required parameter missing: playlistId");
      const p = await env.DB.prepare("SELECT * FROM playlists WHERE id = ? AND user_id = ?").bind(id.n, user.id).first();
      if (!p) throw new SubsonicError(70, "Playlist not found");
      const name = str(url, "name");
      const comment = str(url, "comment");
      const pub = str(url, "public");
      await env.DB.prepare(
        "UPDATE playlists SET name = COALESCE(?, name), comment = COALESCE(?, comment), public = COALESCE(?, public), changed_at = ? WHERE id = ?",
      )
        .bind(name, comment, pub === null ? null : pub === "true" ? 1 : 0, Date.now(), id.n)
        .run();
      for (const sid of url.searchParams.getAll("songIdToAdd")) {
        const parsed = parseId(sid);
        if (parsed?.kind !== "tr") continue;
        const max = await env.DB.prepare("SELECT COALESCE(MAX(position), -1) AS m FROM playlist_tracks WHERE playlist_id = ?")
          .bind(id.n)
          .first<{ m: number }>();
        await env.DB.prepare("INSERT INTO playlist_tracks (playlist_id, track_id, position) VALUES (?, ?, ?)").bind(
          id.n,
          parsed.n,
          (max?.m ?? -1) + 1,
        ).run();
      }
      const remove = url.searchParams.getAll("songIndexToRemove").map(Number).sort((a, b) => b - a);
      if (remove.length) {
        const { results } = await env.DB.prepare("SELECT position FROM playlist_tracks WHERE playlist_id = ? ORDER BY position")
          .bind(id.n)
          .all<{ position: number }>();
        const positions = (results ?? []).map((r) => r.position);
        for (const idx of remove) {
          const pos = positions[idx];
          if (pos === undefined) continue;
          await env.DB.prepare("DELETE FROM playlist_tracks WHERE playlist_id = ? AND position = ?").bind(id.n, pos).run();
        }
      }
      return ok(env, fmt);
    }

    case "deleteplaylist": {
      const id = parseId(str(url, "id"));
      if (!id || id.kind !== "pl") throw new SubsonicError(70, "Playlist not found");
      const p = await env.DB.prepare("SELECT id FROM playlists WHERE id = ? AND user_id = ?").bind(id.n, user.id).first();
      if (!p) throw new SubsonicError(70, "Playlist not found");
      await env.DB.batch([
        env.DB.prepare("DELETE FROM playlist_tracks WHERE playlist_id = ?").bind(id.n),
        env.DB.prepare("DELETE FROM playlists WHERE id = ?").bind(id.n),
      ]);
      return ok(env, fmt);
    }

    case "star":
    case "unstar": {
      const t = Date.now();
      const pairs: [string, number][] = [];
      for (const [param, kind] of [
        ["id", "song"],
        ["albumId", "album"],
        ["artistId", "artist"],
      ] as const) {
        for (const raw of url.searchParams.getAll(param)) {
          const parsed = parseId(raw);
          if (!parsed) continue;
          const entityType = param === "id" ? (parsed.kind === "al" ? "album" : parsed.kind === "ar" ? "artist" : "song") : kind;
          pairs.push([entityType, parsed.n]);
        }
      }
      for (const [entityType, entityId] of pairs) {
        if (method === "star") {
          await env.DB.prepare(
            "INSERT OR REPLACE INTO stars (user_id, entity_type, entity_id, created_at) VALUES (?, ?, ?, ?)",
          )
            .bind(user.id, entityType, entityId, t)
            .run();
        } else {
          await env.DB.prepare("DELETE FROM stars WHERE user_id = ? AND entity_type = ? AND entity_id = ?")
            .bind(user.id, entityType, entityId)
            .run();
        }
      }
      return ok(env, fmt);
    }

    case "getstarred":
    case "getstarred2": {
      const { results: songs } = await env.DB.prepare(
        `SELECT t.*, al.name AS album_name, ar.name AS artist_name, s.created_at AS starred_at
         FROM stars s
         JOIN tracks t ON t.id = s.entity_id
         JOIN albums al ON al.id = t.album_id
         JOIN artists ar ON ar.id = t.artist_id
         WHERE s.user_id = ? AND s.entity_type = 'song' ORDER BY s.created_at DESC`,
      )
        .bind(user.id)
        .all<TrackRow>();
      const { results: albums } = await env.DB.prepare(
        `SELECT al.*, ar.name AS artist_name FROM stars s
         JOIN albums al ON al.id = s.entity_id
         JOIN artists ar ON ar.id = al.artist_id
         WHERE s.user_id = ? AND s.entity_type = 'album' ORDER BY s.created_at DESC`,
      )
        .bind(user.id)
        .all();
      const { results: artists } = await env.DB.prepare(
        `SELECT a.* FROM stars s JOIN artists a ON a.id = s.entity_id
         WHERE s.user_id = ? AND s.entity_type = 'artist' ORDER BY s.created_at DESC`,
      )
        .bind(user.id)
        .all();
      const key = method === "getstarred2" ? "starred2" : "starred";
      return ok(env, fmt, {
        [key]: {
          artist: (artists ?? []).map((a) => artistPayload(a as never)),
          album: (albums ?? []).map((a) => albumPayload(a as never)),
          song: (songs ?? []).map((t) => songPayload(t, t.starred_at)),
        },
      });
    }

    case "scrobble": {
      const id = parseId(str(url, "id"));
      if (!id || id.kind !== "tr") throw new SubsonicError(10, "Required parameter missing: id");
      const submission = str(url, "submission") !== "false";
      const playedAt = intParam(url, "time", Date.now());
      if (submission) {
        await env.DB.batch([
          env.DB.prepare("INSERT INTO scrobbles (user_id, track_id, played_at, submission) VALUES (?, ?, ?, 1)").bind(
            user.id,
            id.n,
            playedAt,
          ),
          env.DB.prepare("UPDATE tracks SET play_count = play_count + 1, last_played = ? WHERE id = ?").bind(playedAt, id.n),
          env.DB.prepare(
            `UPDATE albums SET play_count = play_count + 1, last_played = ? WHERE id = (SELECT album_id FROM tracks WHERE id = ?)`,
          ).bind(playedAt, id.n),
        ]);
      }
      return ok(env, fmt);
    }

    case "getplayqueue": {
      const q = await env.DB.prepare("SELECT * FROM play_queue WHERE user_id = ?").bind(user.id).first<{
        current_track_id: number | null;
        position_sec: number;
        changed_at: number;
        tracks_json: string;
      }>();
      if (!q) return ok(env, fmt);
      const ids: number[] = JSON.parse(q.tracks_json || "[]");
      const songs: TrackRow[] = [];
      for (const tid of ids) {
        const t = await trackById(env, tid);
        if (t) songs.push(t);
      }
      return ok(env, fmt, {
        playQueue: {
          current: q.current_track_id ? trackId(q.current_track_id) : undefined,
          position: Math.round((q.position_sec || 0) * 1000),
          username: user.username,
          changed: iso(q.changed_at),
          changedBy: "Relief",
          entry: await withStars(env, user, songs),
        },
      });
    }

    case "saveplayqueue": {
      const ids = url.searchParams.getAll("id").map(parseId).filter((p) => p?.kind === "tr").map((p) => p!.n);
      const current = parseId(str(url, "current"));
      const position = intParam(url, "position", 0) / 1000;
      await env.DB.prepare(
        `INSERT INTO play_queue (user_id, current_track_id, position_sec, changed_at, tracks_json)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(user_id) DO UPDATE SET current_track_id=excluded.current_track_id, position_sec=excluded.position_sec, changed_at=excluded.changed_at, tracks_json=excluded.tracks_json`,
      )
        .bind(user.id, current?.kind === "tr" ? current.n : null, position, Date.now(), JSON.stringify(ids))
        .run();
      return ok(env, fmt);
    }

    case "getlyrics": {
      const artistName = str(url, "artist") || "";
      const titleName = str(url, "title") || "";
      const track = artistName && titleName ? await findTrackByArtistTitle(env, artistName, titleName) : null;
      let value = "";
      if (track) {
        const lyrics = await getOrFetchLyrics(env, track.id, artistName, titleName, track.album_name, track.duration_sec);
        value = lyrics?.plain || (lyrics?.synced ? parseLrc(lyrics.synced).map((l) => l.value).join("\n") : "");
      }
      return ok(env, fmt, { lyrics: { artist: artistName, title: titleName, value } });
    }

    case "getlyricsbysongid": {
      const id = parseId(str(url, "id"));
      const track = id?.kind === "tr" ? await trackById(env, id.n) : null;
      if (!track) return ok(env, fmt, { lyricsList: {} });

      const lyrics = await getOrFetchLyrics(
        env,
        track.id,
        track.artist_name || "",
        track.title,
        track.album_name,
        track.duration_sec,
      );
      if (!lyrics) return ok(env, fmt, { lyricsList: {} });

      const synced = lyrics.synced ? parseLrc(lyrics.synced) : null;
      const line =
        synced && synced.length
          ? synced.map((l) => ({ start: l.start ?? undefined, value: l.value }))
          : (lyrics.plain || "").split(/\r?\n/).filter(Boolean).map((value) => ({ value }));

      return ok(env, fmt, {
        lyricsList: {
          structuredLyrics: [
            {
              lang: "und",
              synced: !!synced?.length,
              displayArtist: track.artist_name,
              displayTitle: track.title,
              line,
            },
          ],
        },
      });
    }

    case "getartistinfo":
    case "getartistinfo2": {
      const id = parseId(str(url, "id"));
      if (!id) throw new SubsonicError(70, "Not found");
      const artist = id.kind === "ar" ? await artistById(env, id.n) : null;
      const similar = artist
        ? (await env.DB.prepare("SELECT * FROM artists WHERE id != ? ORDER BY RANDOM() LIMIT ?")
            .bind(artist.id, intParam(url, "count", 20))
            .all<{ id: number; name: string; album_count: number }>()
          ).results ?? []
        : [];
      const key = method === "getartistinfo2" ? "artistInfo2" : "artistInfo";
      return ok(env, fmt, {
        [key]: {
          biography: "",
          similarArtist: similar.map(artistPayload),
        },
      });
    }

    case "getalbuminfo":
    case "getalbuminfo2":
      return ok(env, fmt, { [method === "getalbuminfo2" ? "albumInfo2" : "albumInfo"]: { notes: "" } });

    case "getscanstatus":
      return ok(env, fmt, { scanStatus: { scanning: false, count: 0 } });

    case "startscan":
      return ok(env, fmt, { scanStatus: { scanning: false, count: 0 } });

    default:
      throw new SubsonicError(0, `Endpoint not implemented: ${method}`);
  }
}

export async function handleRest(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: { "access-control-allow-origin": "*", "access-control-allow-methods": "GET, POST, OPTIONS", "access-control-allow-headers": "range, content-type, authorization" } });
  }

  if (request.method === "POST" && (request.headers.get("content-type") || "").includes("application/x-www-form-urlencoded")) {
    const body = await request.text();
    const params = new URLSearchParams(body);
    for (const [k, v] of params) url.searchParams.append(k, v);
  }

  const fmt = formatOf(url);
  const part = url.pathname.split("/").filter(Boolean).pop() || "";
  const method = part.replace(/\.view$/i, "").toLowerCase();
  if (!method) return fail(fmt, 10, "Missing method", env);

  try {
    return await handleMethod(request, env, method, url);
  } catch (err) {
    if (err instanceof SubsonicError) return fail(fmt, err.code, err.message, env);
    const message = err instanceof Error ? err.message : "Internal error";
    return fail(fmt, 0, message, env);
  }
}