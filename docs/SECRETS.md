# Secrets & Environment Variables

Canonical reference for every secret/env var ClaudeAtlas uses, where each one lives, and how to rotate it without breaking CI or production.

## Quick map

| Variable | Used by | Local `.env` | GitHub Actions secret | Cloudflare Worker secret |
|---|---|:---:|:---:|:---:|
| `GITHUB_TOKEN` | `scripts/scrape.js`, `scripts/backfill-*.js` run locally | ✅ | — | — |
| `SCRAPE_PAT` | Daily cron scraper in CI | — | ✅ | — |
| `CF_API_TOKEN` | `wrangler deploy` in CI | — | ✅ | — |
| `CF_ACCOUNT_ID` | `wrangler deploy` in CI | — | ✅ | — |
| `PUBLIC_POSTHOG_KEY` | Built into client bundle | ✅ | ✅ | — |
| `PUBLIC_CF_ANALYTICS_TOKEN` | ~~Build-time client bundle~~ — NOT USED, we use CF Automatic Setup | — | — | — |
| `SALT_SECRET` | `worker/log-search.js` at runtime | — | — | ✅ |

**Rule of thumb:**
- Anything starting with `PUBLIC_` is baked into the static HTML at build time. Not a true secret — visible in the browser. Still don't hardcode it.
- Anything `GITHUB_TOKEN` / `SCRAPE_PAT` / `CF_*` is for build/scraper tooling. Never goes into the client bundle.
- `SALT_SECRET` is the only true runtime secret. Lives only inside the Cloudflare Worker, never in the repo, never in CI.

## Detailed entries

### `GITHUB_TOKEN` — local scrapes/backfills

- **Scope:** fine-grained PAT, `Public Repositories (read-only)` contents + metadata
- **Where to create:** https://github.com/settings/tokens?type=beta
- **Where it lives:** local `.env` file at repo root (gitignored)
- **Rotation:** revoke the old one at the URL above, create a new one, update your local `.env`. No CI impact because this token is never used in CI.
- **Why separate from `SCRAPE_PAT`:** lets you rotate your personal dev token without breaking the daily cron, and vice versa.

### `SCRAPE_PAT` — daily cron scraper

- **Scope:** same as `GITHUB_TOKEN` — fine-grained PAT with read-only public repos
- **Where it lives:** GitHub Actions secret at `https://github.com/dwalshx/ClaudeAtlas/settings/secrets/actions`
- **Used by:** `.github/workflows/daily-scrape.yml` — passed to `npm run scrape` as `GITHUB_TOKEN` env var
- **Rotation:**
  1. Create a new fine-grained PAT on GitHub
  2. Update the `SCRAPE_PAT` repo secret with the new value
  3. Revoke the old PAT
  4. Next scheduled or manual workflow run will pick up the new token automatically

### `CF_API_TOKEN` — Cloudflare deploy auth

- **Scope:** needs `Workers Scripts:Edit` + `Account Settings:Read`. If you provision D1 in CI later, add `D1:Edit` too.
- **Where to create:** https://dash.cloudflare.com/profile/api-tokens → "Create Token" → "Edit Cloudflare Workers" template (or custom)
- **Where it lives:** GitHub Actions secret `CF_API_TOKEN`
- **Used by:** `cloudflare/wrangler-action@v3` in the deploy step
- **Rotation:** create new token with the same scopes, update the repo secret, then roll the old one. Test with a `workflow_dispatch` run before deleting the old token.

### `CF_ACCOUNT_ID` — Cloudflare account ID

- **Not really a secret** — it's just an identifier — but stored as a GitHub Actions secret for consistency.
- **Where to find:** any Cloudflare dashboard page, bottom-right "Account ID"
- **Where it lives:** GitHub Actions secret `CF_ACCOUNT_ID`
- **Rotation:** never changes unless you move accounts.

### `PUBLIC_POSTHOG_KEY` — PostHog project key

- **Scope:** project API key for analytics event capture. Technically "public" (embedded in client HTML) but still managed as a secret to avoid hardcoding.
- **Where to create:** https://eu.posthog.com → Project Settings → "Project API Key" (the one that starts with `phc_...`, NOT the personal API key)
- **Where it lives:**
  - Local dev: `.env` file (so `npm run dev` picks it up)
  - CI builds: GitHub Actions secret `PUBLIC_POSTHOG_KEY` — the workflow passes it to `npm run build` as an env var
- **Behavior when unset:** `src/lib/analytics.js` returns an empty snippet, PostHog loader isn't injected, no events fire. Site builds and works normally.
- **Rotation:** create a new project in PostHog, update both places (local `.env` and GH secret), trigger a rebuild. The old key stops receiving events immediately.
- **Host:** we use the EU cloud (`https://eu.i.posthog.com`) hardcoded in `src/lib/analytics.js` for GDPR reasons. Don't sign up at `us.posthog.com`.

### `PUBLIC_CF_ANALYTICS_TOKEN` — NOT USED

- **Status:** deprecated in favor of Cloudflare "Automatic Setup" for Web Analytics.
- **Why:** Cloudflare injects the beacon server-side for CF-managed domains, so we don't need a client-side token or env var. Zero code paths to maintain.
- **Where Web Analytics data comes from:** Cloudflare dashboard → Analytics & Logs → Web Analytics → `claudeatlas.com`. Toggle Automatic Setup to disable.

### `SALT_SECRET` — Worker IP hashing salt

- **Scope:** any random string, 32+ chars recommended. Used by `worker/log-search.js` to hash visitor IPs so the D1 search-event log can't be reverse-engineered back to individual users.
- **Where it lives:** Cloudflare Worker secret via `wrangler secret put SALT_SECRET` (encrypted, only accessible from the running worker)
- **Rotation:** `wrangler secret put SALT_SECRET` with a new value. This breaks same-day deduplication for one day (because yesterday's hashes no longer match today's), but analytics remain valid.
- **If unset:** the worker falls back to hashing `""+date+ip`, which is less secure but still hash-only. Not catastrophic; just set it.

## Typical rotation flows

### "I accidentally pasted my PAT in a chat / Slack / commit"

1. Revoke the token at https://github.com/settings/tokens immediately
2. Create a new fine-grained PAT
3. Update everywhere it was used:
   - Local `.env` → edit `GITHUB_TOKEN`
   - GitHub Actions `SCRAPE_PAT` secret (if the leaked token was the same as the CI token — which it shouldn't be, see above)
4. Trigger a `workflow_dispatch` run of `daily-scrape.yml` to confirm CI still passes

### "I want to enable PostHog / CF Analytics for the first time"

1. Sign up / log into the service
2. Grab the key/token
3. Add to `.env` at repo root
4. Add as GitHub Actions secret (same name)
5. Push or trigger a workflow run — the key gets baked into the next build and deploy

### "I want to add a new secret"

1. Pick its scope: local-only, CI-only, runtime-only, or some combination
2. Add an entry to `.env.example` (committed) with the name and a comment explaining what it's for
3. Add an entry to this file (SECRETS.md) with the same detail
4. Create the secret in the right place(s)
5. Wire it into the code via `import.meta.env.VAR_NAME` (build-time) or `process.env.VAR_NAME` (scripts) or `env.VAR_NAME` (worker)

## Never commit

- `.env` (gitignored via the existing `.env.*` rule)
- Any real value of any secret in this file (all examples should be `phc_...` / `REPLACE_ME` placeholders)
- Rotated-out tokens "just in case" — always delete
