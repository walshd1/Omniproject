# Local standalone stack — bootstrap

`docker-compose.standalone.yml` runs the whole thing locally: the omni-shell, n8n,
Ollama, a local **Authentik** IdP, and **Traefik** terminating real TLS for
`*.local`. This is the one-time setup. The lean BYO profile
(`docker-compose.enterprise.yml`) needs none of this — see its header.

## Why these steps exist

- **Real TLS, not ACME.** Let's Encrypt **cannot** issue certificates for `.local`
  names, so the stack uses [mkcert](https://github.com/FiloSottile/mkcert) (a
  locally-trusted CA) plus a Traefik file provider. Without this, the OIDC login
  flow fails for a TLS reason that has nothing to do with DNS: `openid-client`
  refuses a plain-`http://` issuer, and `Secure` session cookies aren't stored
  over http.
- **One issuer hostname, no hairpin.** Traefik carries network aliases for every
  `*.local` name, so the shell's *server-side* OIDC calls to
  `https://authentik.local` resolve to the proxy **inside** the Docker network,
  while your browser resolves the same name via `/etc/hosts`. Same hostname both
  sides → the `iss` claim validates.

## 1. Certificates (mkcert)

```bash
mkcert -install                              # trust the local CA (browser + system)
mkdir -p certs
mkcert -cert-file certs/local.pem -key-file certs/local-key.pem \
       app.local n8n.local authentik.local ollama.local traefik.local
cp "$(mkcert -CAROOT)/rootCA.pem" certs/rootCA.pem
```

`certs/*.pem` are git-ignored. `rootCA.pem` is mounted into the shell as
`NODE_EXTRA_CA_CERTS` so its call to `https://authentik.local` validates.

## 2. Hostnames

```bash
echo "127.0.0.1 app.local n8n.local authentik.local ollama.local traefik.local" | sudo tee -a /etc/hosts
```

## 3. Secrets (`.env`)

Copy `.env.example` → `.env` and fill the **required** values for the standalone
stack (`SESSION_SECRET`, `OIDC_CLIENT_SECRET`, `AUTHENTIK_PG_PASSWORD`,
`AUTHENTIK_SECRET_KEY`, `TRAEFIK_DASHBOARD_AUTH`). Compose **fails fast** if any
is missing — it will not boot with placeholder defaults.

> **The `$$` rule.** A bcrypt htpasswd hash is full of `$`. In a `.env` *file*,
> Compose interpolates values, so every `$` must be **doubled to `$$`**
> (`admin:$$2y$$05$$…`). Single `$` only works when the value is *exported in your
> shell*, not in `.env`. Get this wrong and the dashboard auth string is mangled
> (locked-out dashboard or a startup interpolation error). Generate the line with
> `htpasswd -nbB admin 'your-password'`.

## 4. Bring it up

```bash
docker compose -f docker-compose.standalone.yml up -d
```

Services start in dependency order — the shell waits for n8n **and** Authentik to
report healthy, Authentik waits for Postgres. First boot pulls images and
runs Authentik migrations (≈1–2 min); the `start_period` budgets for it.

## 5. Identity: the OmniProject app + role groups are pre-created

The bundled **Authentik** auto-applies `infra/authentik/blueprints/omniproject.yaml` on boot,
which creates the OmniProject **OAuth2/OpenID provider + application** (slug `omniproject`, so
the issuer is `https://authentik.local/application/o/omniproject/`, redirect URI
`https://app.local/api/auth/callback`) **and** the role groups
`omni-admins · omni-pmo · omni-managers · omni-contributors · omni-viewers`. The provider's
client secret is taken from `OIDC_CLIENT_SECRET` in `.env`, so both sides share one value.

So the one-time setup is just:

1. Finish the initial Authentik admin setup at `https://authentik.local`.
2. Ensure `OIDC_CLIENT_SECRET` is set in `.env` (the blueprint + the shell both read it).

### Create staff accounts (charities / self-hosters)

In the Authentik admin → **Directory → Users**, create a user per staff member, then add each
to the `omni-*` group for their role (admin → `omni-admins`, …). Their OmniProject role follows
from the group — no per-user setup in OmniProject. The app's **Configurator → Staff accounts & roles**
step shows this mapping and the exact callback URL.

> If you'd rather wire it by hand (or the blueprint doesn't apply on your Authentik version),
> create the provider/application/groups manually with the same slug + redirect URI.

Then open **https://app.local**.

## Notes

- **Traefik dashboard:** `https://traefik.local` behind the basicauth you set —
  the insecure `:8080` API port is deliberately not published.
- **n8n** prompts you to create an owner account on first visit
  (`https://n8n.local`); the legacy `N8N_BASIC_AUTH_*` vars are deprecated.
- **Image tags are pinned** for reproducibility. n8n is pinned to the mature
  `1.x` line; `2.x` exists but is unverified against the bundled blueprint.
