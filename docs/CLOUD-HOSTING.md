# Cloud hosting — AWS, GCP, Azure quickstarts

OmniProject is a **stateless, single-container gateway**, so it runs anywhere that runs a container:
managed Kubernetes (EKS/GKE/AKS), a VM, or a PaaS. It's cloud-agnostic by construction — nothing here
is provider-locked. This doc is the fast path per cloud on top of the existing Helm chart
(`deploy/helm/omniproject`).

## Prerequisites (all clouds)

- A published image of the shell (`docker build` from the repo, push to your registry). Set
  `image.repository` / `image.tag`.
- A `SESSION_SECRET` (the gateway **refuses to boot in production without one** — fail-fast, no
  insecure default): `openssl rand -hex 32`.
- Your public origin (`config.PUBLIC_URL`) and, for real auth, an OIDC issuer/client (`secret.data.*`).
- To scale past one replica, a shared real-time bus (`config.REDIS_URL`) — see `values.yaml`.

## AWS (EKS)

```bash
helm upgrade --install omniproject deploy/helm/omniproject \
  -f deploy/helm/omniproject/values-eks.yaml \
  --set image.repository=YOUR_ECR/omniproject-shell --set image.tag=1.0.0 \
  --set config.PUBLIC_URL=https://app.example.com \
  --set-file secret.data.SESSION_SECRET=<(openssl rand -hex 32)
```

- Ingress → ALB via the AWS Load Balancer Controller; TLS at the ALB with an ACM cert.
- **Keyless retention creds via IRSA** — set the pod's IAM role ARN in `serviceAccount.annotations`;
  the S3/DynamoDB retention ports then use short-lived credentials.
- KMS envelope keys: `config.KMS_PROVIDER=aws`. Shared bus: ElastiCache (`config.REDIS_URL`).

## GCP (GKE)

```bash
helm upgrade --install omniproject deploy/helm/omniproject \
  -f deploy/helm/omniproject/values-gke.yaml \
  --set image.repository=YOUR_AR/omniproject-shell --set image.tag=1.0.0 \
  --set config.PUBLIC_URL=https://app.example.com \
  --set-file secret.data.SESSION_SECRET=<(openssl rand -hex 32)
```

- Ingress → external HTTP(S) LB; TLS via a GKE `ManagedCertificate` + a reserved static IP.
- **Keyless retention creds via Workload Identity** — bind the KSA to a Google service account in
  `serviceAccount.annotations`; the GCS/BigQuery retention ports then use keyless credentials.
- Shared bus: Memorystore (`config.REDIS_URL`).

## Azure (AKS)

```bash
helm upgrade --install omniproject deploy/helm/omniproject \
  -f deploy/helm/omniproject/values-aks.yaml \
  --set image.repository=YOUR_ACR/omniproject-shell --set image.tag=1.0.0 \
  --set config.PUBLIC_URL=https://app.example.com \
  --set-file secret.data.SESSION_SECRET=<(openssl rand -hex 32)
```

- Ingress → Application Gateway (AGIC) or nginx; TLS via cert-manager or AGIC.
- **Keyless retention creds via Microsoft Entra Workload Identity** — federate the KSA to a managed
  identity (`serviceAccount.annotations` + the `azure.workload.identity/use` pod label); the
  Blob/Cosmos retention ports then use keyless credentials.
- KMS envelope keys: `config.KMS_PROVIDER=azure`. Shared bus: Azure Cache for Redis.

## VM / PaaS (any cloud)

No Kubernetes required — `docker compose -f docker-compose.standalone.yml up` on a Compute Engine /
Azure VM / EC2 instance, or push the image to Cloud Run / Container Apps / App Runner. The gateway is
stateless, so horizontal scaling only needs `REDIS_URL` for the real-time bus.

## Where data lives

The gateway still **holds nothing**. Project data stays in your connected tool (or the self-host DB);
retained history lives in whichever retention store you wire — S3/GCS/Blob, DynamoDB/Cosmos, or
BigQuery/Snowflake (see [RETENTION-CONNECTORS.md](RETENTION-CONNECTORS.md)). Back up **those** stores;
the gateway pods are disposable.
