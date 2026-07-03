# Running omni-shell behind an existing reverse proxy

The bundled `docker-compose.standalone.yml` ships its own Traefik for a
self-contained local stack. But many people already run a reverse proxy (Traefik,
Caddy, nginx, …) in front of everything and just want to add OmniProject to it on
a public URL. This page covers that — it's deliberately the case the shipped
compose stacks *don't*.

## The only two facts the proxy needs

1. **The container listens on port `3000`** (HTTP, plain). The gateway serves both
   the API (`/api/*`) and the SPA from that one port.
2. **Health is `GET /api/healthz`.**

So any proxy works: terminate TLS at the edge and forward to `omni-shell:3000`.
Everything below is just the wiring, with the sharp edges called out.

## Container settings

```yaml
services:
  omni-shell:
    image: omniproject-shell:latest
    environment:
      # Required — the gateway refuses to boot on an empty/default value.
      SESSION_SECRET: "${SESSION_SECRET:?openssl rand -hex 32}"
      # The public origin (used to build the OIDC redirect URI; harmless in demo).
      PUBLIC_URL: "https://omni.example.com"
    networks: [ proxynet ]          # join the proxy's network
    restart: unless-stopped
    # NOTE: do NOT publish a host port (`ports:`) when proxying — the proxy
    # reaches the container over the shared Docker network on 3000.

networks:
  proxynet:
    external: true
```

> **Demo mode has no login.** With no `OIDC_*` and no `BROKER_URL`, the app runs
> in demo mode with sample data and **no authentication**. If you expose that
> publicly, put auth in front of it (basic auth below) or wire OIDC — don't leave
> an open demo on the internet.

## Traefik (Docker labels)

Real example, with the mistakes that cost an afternoon called out:

```yaml
    labels:
      - "traefik.enable=true"
      - "traefik.docker.network=proxynet"
      - "traefik.http.routers.omniproject.rule=Host(`omni.example.com`)"
      - "traefik.http.routers.omniproject.entrypoints=websecure"
      - "traefik.http.routers.omniproject.tls=true"
      - "traefik.http.routers.omniproject.tls.certresolver=cfresolver"
      - "traefik.http.services.omniproject.loadbalancer.server.port=3000"
      # optional auth for the unauthenticated demo (see below):
      - "traefik.http.routers.omniproject.middlewares=omni-auth@file"
```

Things that bite (every one of these produces a silent 404 or a cert failure):

- **Keep every router/service name identical.** All of `routers.X.*` and
  `services.X.*` must use the *same* `X`. A name split across `omni`, `omniproject`
  and a typo'd `omni[roject` means no single router is complete, and Traefik falls
  back to a default `Host(<container-name>)` rule → wrong cert, 404.
- **The `Host()` rule needs backticks** — ``Host(`omni.example.com`)``, not
  `Host(omni.example.com)`.
- **Match your real entrypoint name.** `websecure` here; some setups call it
  `https`. Wrong name → the router never binds to `:443`.
- **`traefik.docker.network=proxynet`** is required if the container is on more
  than one network, so Traefik dials it on the right one. No published host port.
- **Cross-provider middleware needs `@file`.** If you define the auth middleware
  in Traefik's *dynamic file* (the file provider) but the router comes from
  *docker labels*, you must reference it as `omni-auth@file` — a bare `omni-auth`
  resolves to `omni-auth@docker`, which doesn't exist, and Traefik drops the whole
  router (→ 404 with body `404 page not found`).

## Basic auth for the demo (three ways, pick one)

The bcrypt hash contains `$` and sometimes `/`, which trip up layered escaping.
In rough order of least pain:

1. **Define it in Traefik's dynamic file (raw hash, no escaping):**
   ```yaml
   # in your traefik dynamic .yml — file provider, so the hash is literal:
   http:
     middlewares:
       omni-auth:
         basicAuth:
           users:
             - "admin:$2y$05$....raw-hash-with-slashes-is-fine...."
   ```
   then reference `omni-auth@file` from the router label. **`basicAuth` is
   camelCase** in the file (it's `basicauth` only in docker labels).
2. **`usersfile` mounted into Traefik:** the file must live **inside the Traefik
   container** (that's where the middleware runs) — mount it on the *Traefik*
   service, not omni. Raw hash in the file, no `$$` doubling.
3. **Inline on the docker label:** double every `$` → `$$` (compose escaping) and
   regenerate until the hash has no `/`:
   ```bash
   docker run --rm httpd:2.4-alpine htpasswd -nbB admin 'pw' | sed 's/\$/\$\$/g'
   ```
   ```yaml
   - "traefik.http.middlewares.omni-auth.basicauth.users=admin:$$2y$$05$$<no-slash-hash>"
   ```

## nginx / Caddy

Nothing special — proxy to `omni-shell:3000`, terminate TLS at the edge.

```nginx
# nginx
location / {
    proxy_pass http://omni-shell:3000;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Proto $scheme;
}
```

```caddy
# Caddyfile
omni.example.com {
    reverse_proxy omni-shell:3000
}
```

## Deployment profile & TLS posture — which source wins

The **deployment profile** (`enterprise` · `business` · `nonprofit` · `self-hosted` · `demo`)
drives the TLS posture: whether session cookies are `Secure` and whether HSTS is sent. It can be
set two ways, and they resolve with a deliberate precedence — worth knowing so it isn't a surprise
when you terminate TLS at the edge:

| Context | What decides the active profile |
| --- | --- |
| **Normal runtime** (request-time `Secure`-cookie / HSTS decisions, the Configurator) | The **persisted Configurator choice wins**, then the `DEPLOYMENT_PROFILE` env var, then the `business` default. So an admin can pick the context in-app on a fresh deploy without redeploying. |
| **Boot security-check** (the startup posture validation) | Uses the **`DEPLOYMENT_PROFILE` env var only** — the persisted setting is deliberately *not* consulted, so what's validated at startup is the declared infrastructure posture, not a later in-app override. |

Practical implications behind a TLS-terminating proxy:

- Cookies are `Secure` whenever the active profile requires TLS (`enterprise`/`business`). The app
  trusts `X-Forwarded-Proto` — make sure your proxy sets it (the nginx/Caddy snippets above do), or
  a `Secure` cookie won't be sent back over what the app sees as plain HTTP and logins will "not
  stick".
- A LAN/self-hosted instance on plain HTTP should run the `self-hosted` (or `nonprofit`/`demo`)
  profile so cookies aren't marked `Secure` — otherwise the browser drops them. Set
  `DEPLOYMENT_PROFILE=self-hosted` for the boot default, or pick it in the Configurator at runtime.
- To pin the posture immutably from infrastructure (so no in-app change can relax it at the
  security-check), set `DEPLOYMENT_PROFILE` in the environment and treat the Configurator as advisory.

## Quick triage when it doesn't load

Isolate the layer — app vs. proxy vs. CDN:

```bash
# 1. App directly (bypass proxy + CDN). Should be 200.
IP=$(docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' omni-shell)
curl -sI "http://$IP:3000/" | head -1

# 2. Proxy directly, bypassing any CDN (forces the request to local Traefik):
curl -skI https://omni.example.com --resolve omni.example.com:443:127.0.0.1 | head -1

# 3. Through the CDN (what the browser sees):
curl -sI https://omni.example.com | head -1
```

- `#1` 404 → app/image problem (check the image actually serves the SPA).
- `#1` 200 but `#2` 404 → the **proxy** isn't routing (router-name/entrypoint, or a
  broken middleware dropping the router — check `docker logs <traefik>`).
- `#2` 200 but `#3` 404 → it's the **CDN** (e.g. Cloudflare cache / SSL mode; set
  Full (strict) once the proxy serves a real cert).

See also: [DEPLOY-LOCAL.md](DEPLOY-LOCAL.md) (the bundled Traefik stack) ·
[TECHNICAL.md](TECHNICAL.md).
