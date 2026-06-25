# Local TLS certificates (mkcert)

This directory holds the locally-trusted certificate the **standalone** stack
serves for `*.local`. The contents are **git-ignored** (`*.pem`, `*.key`) — never
commit a private key.

Generate them once with [mkcert](https://github.com/FiloSottile/mkcert):

```bash
mkcert -install                              # trust the local CA (browser + system)
mkcert -cert-file certs/local.pem -key-file certs/local-key.pem \
       app.local n8n.local authentik.local ollama.local traefik.local
cp "$(mkcert -CAROOT)/rootCA.pem" certs/rootCA.pem   # so the shell's Node can trust it
```

Expected files after this step:

- `local.pem` / `local-key.pem` — the leaf cert + key Traefik serves (mounted at `/certs`).
- `rootCA.pem` — the mkcert root CA, mounted into `omni-shell` as `NODE_EXTRA_CA_CERTS`
  so its server-side OIDC call to `https://authentik.local` validates.

See [docs/DEPLOY-LOCAL.md](../docs/DEPLOY-LOCAL.md) for the full bootstrap.
