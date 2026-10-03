# The Directory

A self-hosted homelab homepage built with Astro, React, and TypeScript. Inspired by Homarr's dashboard concept, with an original interface and no dependency on Homarr code or assets.

## Run in Docker

Follow these steps in order. Start by getting the app working locally, then follow the public-access steps below if you want to reach it through your domain. You do not need Node.js or npm installed on the Docker host.

### Step 1: Install Docker and check that it is running

On Windows or macOS, install [Docker Desktop](https://www.docker.com/products/docker-desktop/) and start it. On Windows, use Linux containers; the image is based on Alpine Linux. On a Linux server, install [Docker Engine](https://docs.docker.com/engine/install/) and the [Docker Compose plugin](https://docs.docker.com/compose/install/linux/).

Open PowerShell on Windows or a terminal on Linux/macOS and run:

```sh
docker --version
docker compose version
docker info
```

The first two commands should print version numbers. `docker info` should show server information without a connection error. If Docker Desktop is installed but stopped, start it before continuing. On Linux, your account must have permission to use Docker, or you must run the Docker commands with `sudo`.

### Step 2: Download the repository

If you have Git installed:

```sh
git clone https://github.com/Endlesszombiez/TheDirectory.git
cd TheDirectory
```

Alternatively, download and extract the repository ZIP from GitHub and open a terminal in the extracted folder. If you already have the repository on your machine, open that folder instead of cloning it again.

Run all remaining Docker commands from the folder containing `compose.yaml`.

### Step 3: Create your environment file

On Windows, run this in PowerShell:

```powershell
Copy-Item .env.example .env
notepad .env
```

On Linux/macOS:

```sh
cp .env.example .env
nano .env
```

Copy the example only on your first setup; copying it again would overwrite your existing settings. You can use any text editor in place of Notepad or nano. On Windows, make sure the saved filename is `.env`, not `.env.txt`.

### Step 4: Set your administrator credentials

Edit the following three values in `.env`:

```dotenv
DASHBOARD_USERNAME=admin
DASHBOARD_PASSWORD='REPLACE_THIS_WITH_YOUR_OWN_UNIQUE_PASSWORD'
APP_ORIGIN=http://localhost:4321
```

Replace the password placeholder with your own unique password before starting the container. The username must be 3–40 lowercase letters, numbers, dots, dashes, or underscores and start with a letter or number. The password must be 12–128 characters. Single quotes around a password prevent Compose from treating `$` characters as variable references; choose a password without a single quote if using this example's quoting.

Save the file. Leave `APP_ORIGIN` as `http://localhost:4321` for the local setup. There is no default password or public signup. Missing or invalid first-run credentials leave the dashboard locked.

The `.env` file is ignored by Git. Keep it private and do not include it in screenshots or support messages.

### Step 5: Validate, pull, and start the container

```sh
docker compose config --quiet
docker compose pull
docker compose up -d
```

The first command validates the Compose configuration without printing your credentials. If it reports an error, fix that error before running the second command.

The second command downloads the prebuilt image from GitHub Container Registry (GHCR), and the third starts it in the background. Images support Linux AMD64 and ARM64. Once the package is public, pulling requires no GitHub account or registry login.

To pull the image directly without Compose:

```sh
docker pull ghcr.io/endlesszombiez/thedirectory:latest
```

### Step 6: Check the running service

```sh
docker compose ps
docker compose logs --tail=100 directory
```

Look for the `directory` service, container name `thedirectory`, and a running status. The health status may show `starting` initially; allow about a minute for it to become `healthy`. The logs should show the server listening on port `4321` inside the container.

Open `http://localhost:4321/api/health` in your browser. A running service returns:

```json
{ "status": "ok" }
```

This endpoint checks that the web process is responding. Login and first-run account setup are checked separately in the next step.

### Step 7: Sign in and configure your dashboard

Open **http://localhost:4321** in a browser on the same machine that runs Docker. Sign in using the username and password you saved in `.env`.

- Use **Edit dashboard** to change the example service cards to your real homelab URLs, remove individual cards, or choose **Remove all services** to clear the current board.
- Use **Customization** to adjust the layout, themes, widgets, and backgrounds.
- Open **People & permissions** to create additional accounts. Use the **Viewer** role for people who should not edit your dashboard.
- Open **My account** through your username in the sidebar to change your password or sign out.

The starter `.home` service addresses are examples. Docker does not create those services or DNS entries. Health checks run from inside the container, so monitored URLs must be reachable from the container; `localhost` in a service URL refers to the container itself, not another machine in your homelab.

Once accounts exist, the bootstrap variables are ignored: changing `DASHBOARD_PASSWORD` in `.env` does not change an existing account's password. Use **My account**, the administrator's user management page, or the [account recovery procedure](#account-recovery).

### Step 8: Access an installation on a remote server

The supplied Compose file binds port `4321` to `127.0.0.1` on the Docker host. This allows a reverse proxy on that host to connect, while keeping the application port off the public network.

If Docker runs on a remote Linux server, you can test it from your computer using an SSH tunnel:

```sh
ssh -L 4321:127.0.0.1:4321 your-user@your-docker-server
```

Replace the username and server address, keep the SSH session open, and browse to `http://localhost:4321` on your computer. This uses the same local `APP_ORIGIN` from step 4. Your computer's port `4321` must be free.

For normal public access through a domain, follow [Public access and account permissions](#public-access-and-account-permissions) below. After changing `APP_ORIGIN` in `.env`, apply it with:

```sh
docker compose up -d --force-recreate directory
```

Then use the exact HTTPS URL you configured. A plain `docker compose restart` does not reload changed environment variables.

### Step 9: Stop, restart, and update the app

Stop the service while keeping the container and data:

```sh
docker compose stop directory
```

Start it again:

```sh
docker compose start directory
```

To download the latest published image and recreate the service:

```sh
docker compose pull directory
docker compose up -d directory
```

`docker compose down` removes the containers and network but preserves the named data volume. **Do not use `docker compose down -v` unless you intend to delete your dashboard, accounts, and sessions.**

### Step 10: Back up the persistent data

Configuration and accounts are stored in the `directory-data` named volume mounted at `/app/data`. Compose normally prefixes the volume name with the project directory name. The files persist through container restarts and image updates.

For a consistent backup, stop the app, copy its data out, and start it again:

```sh
docker compose stop directory
docker compose cp directory:/app/data ./directory-backup
docker compose start directory
```

Use a new destination folder for each backup. Store the backup privately: it includes account password hashes and hashed session records. **Export dashboard** in the app backs up dashboard configuration only; it does not include accounts or sessions.

### Docker troubleshooting

| Symptom                                                       | What to check                                                                                                                                                                                   |
| ------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `docker` is not recognized or `docker compose` is unavailable | Install Docker Desktop or Docker Engine with the Compose plugin, then open a new terminal.                                                                                                      |
| Cannot connect to the Docker daemon                           | Start Docker Desktop or the Docker service. On Linux, check your account's Docker permissions.                                                                                                  |
| `no configuration file provided`                              | Run the command from the repository folder containing `compose.yaml`.                                                                                                                           |
| Port `4321` is already allocated                              | Stop the other service, or change the host mapping to `127.0.0.1:8080:4321` and set `APP_ORIGIN=http://localhost:8080`. Recreate the container and use the new URL.                             |
| Browser cannot reach the page                                 | Check `docker compose ps` and logs. Use `localhost` on the Docker host, an SSH tunnel, or your configured reverse proxy; the default port is not bound to the server's public IP.               |
| “Set up your administrator” appears                           | Check that `.env` exists and contains a valid username and a password of at least 12 characters. Recreate the service after correcting it.                                                      |
| “Invalid origin” on login or saving                           | Make `APP_ORIGIN` match the browser's scheme, hostname, and port exactly, with no trailing slash. `localhost` and `127.0.0.1` are different origins. Recreate the service after editing `.env`. |
| HTTPS login fails or does not stay signed in                  | Use the HTTPS URL specified by `APP_ORIGIN`, ensure your proxy forwards the original Host header, and verify TLS is working. HTTPS sessions use Secure cookies.                                 |
| Changing `.env` did not change the administrator password     | Existing accounts are stored in the volume. Follow [Account recovery](#account-recovery) instead.                                                                                               |
| “Too many attempts” appears                                   | Wait 15 minutes before trying again; login attempts are throttled.                                                                                                                              |
| The container exits or stays unhealthy                        | Read `docker compose logs --tail=100 directory`. Check build errors and data-volume permissions. The app runs as the unprivileged `node` user.                                                  |

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

## Publishing Docker images

The [CI workflow](.github/workflows/ci.yaml) publishes `ghcr.io/endlesszombiez/thedirectory` after the build, tests, and Docker smoke test pass. Pushes to `main` update `latest`; every published build also gets a `sha-<short-commit>` tag. Pushing a version tag such as `v0.1.0` publishes `0.1.0` and `0.1` image tags. Version-tag builds do not replace `latest`. You can also select **Run workflow** on the Actions CI page with `main` selected to republish it.

Publishing uses the workflow's `GITHUB_TOKEN` with `packages: write`; no separate registry secret is needed. Images include a source label linking them to this repository.

GitHub creates new GHCR packages as private, even when the repository is public. After the first successful publish, open the [package page](https://github.com/users/Endlesszombiez/packages/container/package/thedirectory), select **Package settings**, and change the package visibility to **Public**. This one-time setting allows unauthenticated pulls. Repository visibility and package visibility are separate.

## Local development

To build your own Docker image from local source changes and use it with the supplied Compose file:

```sh
docker build -t ghcr.io/endlesszombiez/thedirectory:latest .
docker compose up -d --pull never directory
```

Running `docker compose pull` later replaces that local image with the published version.

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
- Docker/Compose and Swarm service discovery with editable URL suggestions, selection, and duplicate-safe bulk import.
- Optional per-user ChatGPT plan connections and prompt-based dashboard setup with preview and explicit Apply.
- Opt-in server-side service health checks with latency, a 3.5-second timeout, bounded concurrency, and a 30-second cache. Checks run while a dashboard client is polling; this is not a historical uptime monitor. 2xx/3xx and authentication-required 401/403 responses count as reachable; redirects are not followed and TLS certificates are validated.
- Validated configuration import/export, atomic JSON writes, and revision checks to prevent tabs overwriting each other's changes. Reload if another tab saves first.
- Required session login, administrator/viewer roles, account management, session revocation, password changes, login throttling, same-origin mutation checks, and a public container health endpoint.

Starter cards are examples using `.home` addresses. Edit their URLs before using them. Health monitoring is disabled until explicitly enabled. System metrics describe the OS visible to Node and can differ from container resource limits. Docker stats are live when configured; no synthetic operational numbers are shown.

## Embedded Portainer and Dockhand

The sidebar includes **Portainer** and **Dockhand** under **Container managers**. Each entry is disabled until its URL is configured; select the adjacent information button for setup instructions. Either or both can be enabled independently.

Set the desired variables in your server environment or `.env` file:

```dotenv
PORTAINER_HOME_URL=http://localhost:3333
DOCKHAND_HOME_URL=http://localhost:3000
```

Use full HTTP(S) URLs without embedded credentials. Invalid values keep the corresponding entry disabled with configuration guidance. These URLs are sent to signed-in users' browsers; they must not contain secrets. Restart the local server after changes. For the supplied Docker Compose deployment, apply changes with `docker compose up -d directory`; Compose passes both variables into the container without rebuilding the image. If running with `docker run`, supply them using `-e`.

Select an enabled entry to open its interface inside TheDirectory while keeping the sidebar and top navigation. Select a board to return to the dashboard. The embedded view includes **Reload**, **Open in new tab**, and troubleshooting information.

The URL must be reachable from the **browser**, not just the app container. `localhost` and `127.0.0.1` refer to the device running the browser; use a LAN address or hostname for remote access. Docker service names usually cannot be resolved by browsers. When TheDirectory uses HTTPS, configure an HTTPS URL for the embedded service too.

Portainer or Dockhand must permit iframe embedding from TheDirectory's origin. Their `X-Frame-Options` or CSP `frame-ancestors` headers may block it; configure the service or its reverse proxy as needed. TheDirectory does not bypass those policies or proxy the manager. Each manager retains its own authentication and permissions; TheDirectory's viewer role does not restrict actions inside the manager. Browser cookie restrictions, login-provider frame policies, and untrusted HTTPS certificates may also affect embedded login. If the view stays blank, use its troubleshooting section or **Open in new tab**.

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

A read-only filesystem mount does **not** make the Docker API read-only. Access to the daemon socket grants powerful host permissions even though this application only issues a list request. For hardened installations, use a restricted socket proxy exposing only the required GET routes. Set `DOCKER_API_URL=http://socket-proxy:2375` (or an HTTPS origin) in `.env` or a Compose override to use a proxy on a private Docker network instead of mounting the socket. Allow `GET /containers/json` and, only for Swarm discovery, `GET /services`. Do not expose the proxy publicly. `DOCKER_API_URL` takes precedence over `DOCKER_SOCKET`. Container start/stop/delete controls are intentionally absent from the current integration.

### Discover and import services

Administrators can open **Set up dashboard → Discover services**, choose **Containers / Compose** or **Swarm services**, enter the Docker host address reachable from their browser (for example `http://nas.home`), and choose a destination board. The host address is used to suggest browser links; it does not change the backend Docker connection.

Review suggested names, groups, and URLs, select services, and click **Import selected**. Existing URLs on the destination board are skipped. Health checks start disabled. A container without a published web port or explicit URL stays editable until you provide a browser URL; database and worker ports are not assumed to speak HTTP. Loopback-bound ports on a remote host require a reachable reverse-proxy URL. Discovery lists one connected Docker daemon; Swarm discovery requires a manager endpoint and lists its cluster services. Separate Docker hosts require separate deployments/connections; this release configures one endpoint per installation.

For reliable detection, set optional labels on your containers (or `deploy.labels` on Swarm services):

```yaml
labels:
  directory.name: Jellyfin
  directory.url: https://jellyfin.example.com
  directory.group: Media
  directory.icon: film
  directory.color: purple
  directory.description: Movies and TV
```

`directory.url` takes priority over a simple Traefik `Host(...)` rule and published-port inference. Compound Traefik routing needs an explicit URL. Set `directory.enable: 'false'` to exclude a service. Only display metadata and candidate URLs are returned to the discovery UI; other labels and container environment variables are excluded.

## Optional AI dashboard setup

AI is optional. Discovery and manual editing work without an AI connection, and this application does not provide a shared AI billing account or silently fall back to API-key billing.

### Connect your own ChatGPT plan

1. Open **AI settings** from the sidebar or **My account**.
2. Download the sign-in helper and run `node directory-chatgpt.mjs` on the computer running your browser. You need Node.js 22 or later there. Repository users can run `npm run connect-chatgpt` instead; the helper has no npm dependencies.
3. Open the local address printed by the helper, choose **Continue with ChatGPT**, and grant **Use your ChatGPT plan**. Eligibility and usage limits are controlled by OpenAI; eligible Plus/Pro accounts can share their existing allowance.
4. Import the protected JSON connection file whose path appears in the terminal into **AI settings** on your own dashboard, over HTTPS or localhost.

The helper follows OpenAI's [open-source OAuth flow](https://developers.openai.com/siwc/token-sharing-open-source/sign-in), with a `127.0.0.1` callback, PKCE, state/nonce validation, and signed ID/access-token verification. For remote Docker installations it follows the documented [self-hosted credential-transfer approach](https://developers.openai.com/siwc/token-sharing-open-source/self-hosted-vms); a remote webpage cannot receive a callback addressed to the user's local computer. No partner client secret or operator API key is needed for this open-source flow. Availability remains subject to OpenAI's preview rollout and account/workspace policies.

Use `node directory-chatgpt.mjs --profile another-account` (or `npm run connect-chatgpt -- --profile another-account`) for another account/workspace. Rerun a profile to reconnect its existing registration. The helper keeps its own stable local host identifier and saved registration under `~/.config/thedirectory/`. The server keeps a separate stable host identifier when importing credentials. Transferred sessions currently do not provide host-specific usage attribution/revocation. Each dashboard user can save up to ten registrations, select an active account, and disconnect it. Identity sign-in without plan permission is shown as disabled for AI usage.

Connection files contain private tokens. Keep them out of source control, browser storage, logs, and support transcripts. The helper writes with owner-only permissions on Unix; protect the file with your account's filesystem permissions on Windows. Once imported, let the dashboard own refreshes; do not reuse the same credential session in another running app. Server connections are encrypted in `DATA_DIR/ai-connections.json` with a local `DATA_DIR/ai.key`; protect and back up both files together. Encryption does not protect credentials from someone who can read the key and the data directory. These files are excluded from dashboard exports. Disconnect attempts remote session revocation, clears local tokens, and reports when remote revocation could not be confirmed; you can also disconnect the app in ChatGPT Settings.

### Describe, preview, apply

After importing real services, administrators can open **Set up dashboard → Set up with AI**, choose a model available to their connected ChatGPT account, and describe the desired boards, groups, names, icons, theme, and layout. The request sends their prompt and dashboard display metadata, including service URLs with credentials, query strings, and fragments removed, to OpenAI. Board notes, custom CSS, background URLs, and credentials are excluded from the prompt. Requests use the selected user's ChatGPT plan limits; manage app limits in [ChatGPT Settings → Usage](https://chatgpt.com/settings/usage).

The proposal appears for review and is saved only after **Apply setup**. Validation requires every existing service exactly once and preserves its URL and health-check setting, as well as existing board notes, custom CSS, background, and configuration revision. Invalid, incomplete, or usage-limited responses leave the dashboard unchanged. New services must first be imported or added manually; AI cannot invent endpoints. Viewers can manage their own connections but cannot generate or apply dashboard changes.

## Customizing the frontend

- `src/components/Dashboard.tsx`: React dashboard island, card renderer, widgets, and editor.
- `src/styles/global.css`: design tokens, themes, typography, and responsive layout.
- `src/lib/schema.ts`: validated configuration contract.
- `src/lib/defaults.ts`: first-run boards and starter services.
- `src/lib/store.ts`: file persistence and concurrent-save protection.
- `src/lib/monitor.ts`: service checks and OS information.
- `src/lib/docker.ts`, `discovery.ts`, `dashboard-setup.ts`: Docker transport, discovery, and bulk import.
- `src/lib/ai-connections.ts`, `ai.ts`: protected per-user connections and validated AI proposals.
- `src/components/DashboardSetup.tsx`, `AIConnections.tsx`: setup preview and connection interfaces.
- `scripts/connect-chatgpt.mjs`: portable local OAuth sign-in helper.
- `src/pages/api/`: configuration and status endpoints.
- `src/middleware.ts`: authentication, authorization, origin checks and security headers.
- `src/lib/auth.ts`: password hashing, account persistence, session validation and revocation.
- `src/pages/login.astro`, `account.astro`, `users.astro`: login and account interfaces.
- `scripts/reset-admin.mjs`: operator-only administrator recovery.

The page and API are server-rendered with Astro's standalone Node adapter. React handles interactive editing. There is no external database and no third-party runtime UI service. Fonts load from Google Fonts with local sans-serif fallbacks; self-host the font files if you want a completely offline interface.

Health checks intentionally reach private-network URLs so the app can monitor a homelab. Only grant edit access to trusted people. Network policy should restrict what the container can reach if deployed on a shared or exposed network.

## Scope and next integrations

This is a functional initial release, not full Homarr feature parity. Proxmox, Home Assistant, media, *arr, and other starter cards currently open their apps; they do not yet fetch those apps' APIs. Provider-specific API widgets, per-board permissions, SSO/MFA, drag-and-drop resizing, custom uploaded images/backgrounds, weather, additional provider secret storage, historical metrics, and localization remain future work. Prefer server-side provider adapters and keep credentials out of exported configuration when adding integrations.

The repository includes build and runtime tests. After building, run `npm run test:integration` to verify the production server's authentication, origin checks, configuration validation, and save API. GitHub Actions also builds and smoke-tests the Docker image. Docker image execution must be verified on a machine with Docker installed.
