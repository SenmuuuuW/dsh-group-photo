---
name: dsh-group-photo
description: Spin up, gate, or archive the DSH internal-beta group photo wall — a zero-dependency Node site where members sign in with GitHub OAuth (zero scopes) and are admitted only if they are in a frozen member whitelist. Use when the user wants to run the photo wall, re-freeze the whitelist, export the static memorial archive, or explain its security model.
---

# DSH Group Photo

The group photo wall built for the last night of the DSH internal beta: a polaroid-style wall where every internal tester leaves one message and is immortalized with their GitHub avatar and a `NO.xxx` stamp. It is a standalone zero-dependency Node app, not a Cordis plugin.

## Security model (read before touching anything)

1. **OAuth requests zero scopes.** The authorize URL never carries a `scope` parameter. The OAuth flow only proves "this person is this GitHub user"; it grants nothing.
2. **Admission is a frozen whitelist.** `whitelist.json` is a local snapshot of the tester roster taken while the org was private. Membership in the live org is never consulted at runtime, so org changes (going public, membership churn) cannot affect admission. Match on GitHub user `id` first, `login` (case-insensitive) second.
3. **Fail closed.** If `whitelist.json` is missing or unreadable, every login is rejected (`gate_error`), never admitted.
4. **The PAT is only for re-freezing.** The runtime never reads it. Run `node freeze-whitelist.js` (requires `pat` in `config.json` or `GH_PAT`) to regenerate the snapshot, then revoke the PAT.
5. **Viewing is members-only too.** `GET /api/members` returns 401 without a session cookie; the only session issuance point is the callback handler after a whitelist hit.
6. **Secrets never live in the repo.** `config.json` ships with empty `clientId` / `clientSecret` / `pat`; supply them via `GH_CLIENT_ID`, `GH_CLIENT_SECRET`, `GH_ORG`, `PORT` environment variables.

## Run it

1. Register a GitHub OAuth App; set its Authorization callback URL to `https://<your-host>/auth/callback` (exact match; one URL per app). No device flow, no `Enable Device Flow` checkbox.
2. `GH_CLIENT_ID=… GH_CLIENT_SECRET=… GH_ORG=dsh-external npm start`
3. Open `http://localhost:8808`; `/auth/login` redirects to GitHub, `/auth/callback` exchanges the code, checks the whitelist, and sets the session cookie.

## Maintain

- **Re-freeze the roster**: put a classic PAT with `read:org` into `config.json` → `node freeze-whitelist.js` → revoke the PAT. The server hot-reloads `whitelist.json` on mtime change; no restart needed.
- **Export the static memorial**: `node export-archive.js` → `archive/index.html`, a self-contained page (no server, no login) suitable for GitHub Pages or any static host.
- **Data files**: `members.json` (wall records) and `sessions.json` (sessions) are written next to `server.js`. Back them up before any redeploy on ephemeral-disk platforms.
- **Messages** are capped at 140 chars, deduplicated by GitHub user id, and editable by their author.
