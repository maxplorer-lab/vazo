# vazo — separate open-source instance of Relief with invite-code sign-up

Private OpenSubsonic 1.16.1 for two people. Separate D1 (`vazo_db`) — not shared with `relief`.

Private music server for two people. **OpenSubsonic 1.16.1** — works with Navidrome clients (Feishin, Tempo, Symfonium, DSub, Ultrasonic, Amperfy) and Subsonic clients (Tempus, play:Sub, Audinaut). FLAC and MP3 only. No transcoding.

Runs on Cloudflare free tier: Workers + D1 + R2.

## This repo is the Worker

`wrangler.toml` lives at the **repository root**. Connect **this** GitHub repo in Cloudflare. Leave **Root directory** blank.

A Grok “export” dump is a different tree (TanStack preview + nested `relief/` folder). That nested folder can show as a dead submodule on GitHub. Do not deploy the export.

```
wrangler.toml
migrations/0001_init.sql
src/           # OpenSubsonic API
public/        # browser player + first-run Setup
```

## 1. Fill named resources

Edit `wrangler.toml` (GitHub pencil is fine):

```toml
database_name = "YOUR_D1_DATABASE_NAME"
database_id   = "YOUR_D1_DATABASE_ID"
bucket_name   = "YOUR_R2_BUCKET_NAME"
R2_BUCKET_NAME = "YOUR_R2_BUCKET_NAME"
```

Bindings in code (do not rename):

| Binding | Resource |
| --- | --- |
| `DB` | D1 |
| `MUSIC` | R2 |

## 2. Deploy from the Cloudflare dashboard

Workers → Create → Connect Git → `maxplorer-lab/relief` → Deploy.

Then **Workers → relief → Settings → Variables and Secrets** (not the Git *build* variables). Add type **Secret**:

| Name | Value |
| --- | --- |
| `AUTH_SECRET` | long random string (encrypts stored passwords) |
| `SETUP_SECRET` | one-time token to create the two users |

Redeploy after adding them. Build/CI variables are discarded when the deploy finishes and are **not** visible to `/api/setup`.

Skip `R2_ACCOUNT_ID` / access keys. Streaming uses the `MUSIC` binding.

## 3. Create the D1 tables (run from your terminal)

```powershell
# Apply migrations to vazo_db (after setting VazoDatabaseId variable)
wrangler d1 migrations apply vazo_db --local
# Confirm and apply remote when ready
wrangler d1 migrations apply vazo_db --remote
```

Or paste `migrations/0003_pins.sql` + `migrations/0004_vazo_user_management.sql` + the `lyrics` table (from `0001_init.sql`) into the D1 Console.

## 4. Create the two users

Open `https://relief.<you>.workers.dev` → **Setup**.

Tempus / Feishin / any Subsonic app:

- Server: `https://relief.<you>.workers.dev`
- Username / password from Setup
- Path: empty (API is `/rest/...`)
- No Cloudflare Access in front of `/rest`

Auth accepted: password, `enc:` hex password, token (`t`+`s`), OpenSubsonic `apiKey`, `Authorization: Bearer`.

## Clients

XML and JSON (`f=json`). Unknown Subsonic methods return empty ok (Navidrome-style) so old apps do not crash. Original files stream with HTTP Range. `maxBitRate` is ignored.

## Upload

Browser **Upload** tab after sign-in, or POST `/api/ingest` as the admin. Max 100 MB per file through the Worker.
