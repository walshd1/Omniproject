# syntax=docker/dockerfile:1
#
# Railway has no equivalent of docker-compose's read-only bind mount, so the trick
# docker-compose.standalone.yml uses to auto-provision the OmniProject OAuth app +
# role groups (mounting ./infra/authentik/blueprints read-only into the container)
# doesn't translate. This bakes the SAME blueprint into the image at build time
# instead — same pinned upstream image, same effect, no bind mount needed.
#
# Build context is the REPO ROOT (not this directory) so the COPY below can reach
# infra/authentik/blueprints/. In Railway: point this service's dockerfilePath at
# deploy/railway/authentik/Dockerfile while leaving its root directory as the repo
# root (the default) — see deploy/railway/README.md.
FROM ghcr.io/goauthentik/server:2026.5.3

COPY infra/authentik/blueprints/omniproject.yaml /blueprints/omniproject/omniproject.yaml
