# The Directory

A self-hosted homelab homepage built with Astro, React, and TypeScript. Inspired by Homarr's dashboard concept, with an original interface and no dependency on Homarr code or assets.

## Run in Docker

Copy `.env.example` to `.env`. Set `DASHBOARD_USERNAME` (3–40 lowercase letters/numbers/dots/dashes/underscores, starting with a letter or number) and a unique `DASHBOARD_PASSWORD` (12–128 characters). These create the first administrator; there is no default password or public signup.

```sh
docker compose up -d --build
```

Open `http://localhost:4321` and sign in. Compose binds the port to loopback for a reverse proxy on the same host. Configuration and accounts are stored in the `directory-data` Docker volume. Back up the volume to preserve both; dashboard JSON exports do not include accounts or sessions.

Login is always required. Missing or invalid first-run credentials leave the dashboard locked. Once accounts exist, the bootstrap variables are ignored: changing them does not change an existing account's password.

## Public access and account permissions

1. Set `APP_ORIGIN=https://lab.example.com` to your exact public browser origin, without a trailing slash or path.
2. Put a TLS reverse proxy in front of the loopback port. `deploy/Caddyfile.example` shows a Caddy configuration for a proxy running on the Docker host; replace its hostname with yours. Forward the original Host header. For a proxy running in Docker, connect it to the app's Docker network and proxy to `directory:4321` instead.
3. Sign in as the administrator and open **People & permissions** to create accounts. Give everyday users the **Viewer** role.

Administrators edit every board, notes, appearance, backgrounds and custom CSS, import/export configuration, and manage users. Viewers can read all shared boards, service URLs, notes and status widgets and change their own password; they cannot edit configuration or manage accounts. The server checks permissions independently of the UI. There are no per-board private permissions yet. Dashboard login does not grant access to the linked services themselves.

Passwords are salted and hashed with scrypt. Random session cookies are HttpOnly and SameSite=Strict; they also use Secure when `APP_ORIGIN` is HTTPS. Sessions expire after 12 hours, survive server restarts, and are stored as hashes. Signing out invalidates the current session. Password resets, password changes, role changes, account deletion and administrator session revocation invalidate all sessions for that account. At most ten concurrent sessions are retained per account.

All mutations, including login and logout, require an Origin matching `APP_ORIGIN` (or the request origin when it is unset). The app's middleware performs this check, including behind a TLS proxy. Security headers prevent framing, restrict form actions and disable response caching; HTTPS configuration also enables HSTS.

Login attempts are limited to 15 per username per 15 minutes and 100 total per process per 15 minutes. The per-username counter resets on successful login; the global counter does not. Limits are in memory and reset after restart. Use your reverse proxy for additional connection/IP throttling. This file-based release supports one app replica per data volume. OIDC/SSO and MFA are not included yet.

### Account recovery

Users change their password in **My account**. Administrators can reset another account from **People & permissions**. If the administrator is locked out, stop the app, set the existing administrator's username and a new password in `.env`, and run:

```sh
docker compose stop directory
docker compose run --rm --no-deps directory node scripts/reset-admin.mjs
docker compose up -d directory
```

For a local installation, stop the server and run `npm run reset-admin`. The recovery command requires access to the account data and only resets an existing administrator; it revokes that administrator's sessions. Protect `.env` and backups as private files. After bootstrap or recovery, you may clear the bootstrap credentials from `.env` and restart; accounts remain in the volume.

## Local development

Requires Node.js 22.12+ (Node 22 LTS recommended).

Configure `.env` as described above. `npm run dev` and `npm start` load it automatically; keep `APP_ORIGIN` equal to the local URL while developing.

```sh
npm ci
npm run dev
```

```sh
npm test
npm run build
npm start
```

For a custom data directory, set `DATA_DIR`. Local development defaults to `./data`; the container uses `/app/data`. Dashboard settings are in `dashboard.json`; accounts and hashed sessions are in `auth.json`. Docker Compose reads `.env` for environment configuration; direct `node dist/server/entry.mjs` execution requires environment variables to be provided separately.

## Included

- Multiple boards with editable HTTP/HTTPS service links, descriptions, categories, icons, and colors.
- Drag-and-drop service ordering and keyboard-friendly ordering controls available through **Edit dashboard**. Dropping onto a card in another category moves the service to that category. Categories follow the first service in each category; ordering within a category follows the service list.
- Dark/light appearance, four accent colors, and two to four service columns (responsive on smaller screens).
- Custom welcome subtitle, compact cards, remote background images, and an advanced custom CSS editor. Custom CSS is shared with all dashboard users; grant editing privileges only to trusted people.
- Search with Ctrl/Cmd+K, keyboard-accessible dialogs, and mobile navigation.
- Local clock, server OS metrics, optional Docker container list, and board-specific notes.
- Opt-in server-side service health checks with latency, a 3.5-second timeout, bounded concurrency, and a 30-second cache. Checks run while a dashboard client is polling; this is not a historical uptime monitor. 2xx/3xx and authentication-required 401/403 responses count as reachable; redirects are not followed and TLS certificates are validated.
- Validated configuration import/export, atomic JSON writes, and revision checks to prevent tabs overwriting each other's changes. Reload if another tab saves first.
- Required session login, administrator/viewer roles, account management, session revocation, password changes, login throttling, same-origin mutation checks, and a public container health endpoint.

Starter cards are examples using `.home` addresses. Edit their URLs before using them. Health monitoring is disabled until explicitly enabled. System metrics describe the OS visible to Node and can differ from container resource limits. Docker stats are live when configured; no synthetic operational numbers are shown.

## Optional Docker integration

The app reads `GET /containers/json?all=true` through the Unix socket named by `DOCKER_SOCKET`. On Linux, add a Compose override like:

```yaml
services:
  directory:
    environment:
      DOCKER_SOCKET: /var/run/docker.sock
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock:ro
    group_add:
      - '${DOCKER_GID}'
```

Set `DOCKER_GID` to the socket's owning group ID (`stat -c '%g' /var/run/docker.sock`). The container runs as the unprivileged `node` user. The Docker widget supports Unix sockets; native Windows named pipes are not supported.

A read-only filesystem mount does **not** make the Docker API read-only. Access to the daemon socket grants powerful host permissions even though this application only issues a list request. For hardened installations, use a restricted socket proxy exposing only the required GET route via a Unix socket, or leave this integration disabled. Container start/stop/delete controls are intentionally absent from the current integration.

## Customizing the frontend

- `src/components/Dashboard.tsx`: React dashboard island, card renderer, widgets, and editor.
- `src/styles/global.css`: design tokens, themes, typography, and responsive layout.
- `src/lib/schema.ts`: validated configuration contract.
- `src/lib/defaults.ts`: first-run boards and starter services.
- `src/lib/store.ts`: file persistence and concurrent-save protection.
- `src/lib/monitor.ts`: service checks, OS information, and Docker adapter.
- `src/pages/api/`: configuration and status endpoints.
- `src/middleware.ts`: authentication, authorization, origin checks and security headers.
- `src/lib/auth.ts`: password hashing, account persistence, session validation and revocation.
- `src/pages/login.astro`, `account.astro`, `users.astro`: login and account interfaces.
- `scripts/reset-admin.mjs`: operator-only administrator recovery.

The page and API are server-rendered with Astro's standalone Node adapter. React handles interactive editing. There is no external database and no third-party runtime UI service. Fonts load from Google Fonts with local sans-serif fallbacks; self-host the font files if you want a completely offline interface.

Health checks intentionally reach private-network URLs so the app can monitor a homelab. Only grant edit access to trusted people. Network policy should restrict what the container can reach if deployed on a shared or exposed network.

## Scope and next integrations

This is a functional initial release, not full Homarr feature parity. Proxmox, Home Assistant, media, *arr, and other starter cards currently open their apps; they do not yet fetch those apps' APIs. Provider-specific API widgets, per-board permissions, SSO/MFA, drag-and-drop resizing, custom uploaded images/backgrounds, weather, secrets management, historical metrics, and localization remain future work. Prefer server-side provider adapters and keep credentials out of exported configuration when adding integrations.

The repository includes build and runtime tests. After building, run `npm run test:integration` to verify the production server's authentication, origin checks, configuration validation, and save API. GitHub Actions also builds and smoke-tests the Docker image. Docker image execution must be verified on a machine with Docker installed.
