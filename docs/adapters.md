# Adapter Status

The Round-2 MVP validates the full deploy config shape and implements the common renderer set for sample-backed platform output.

## Implemented

- `traefik-public`: renders public IngressRoute documents for `public` and `public_and_lan` Kubernetes services with backends.
- `traefik-lan`: renders LAN IngressRoute documents for `public_and_lan` and `lan_only` Kubernetes services with backends.
- `gatus`: renders a ConfigMap-compatible `endpoints.yaml` document for ingress and monitoring backends, supports HTTP/TCP conditions, applies SSO/TCP internal-probe defaults, and sorts by group/name.
- `edge-catalog`: renders service entries with cluster, service, exposure, access, and host fields.
- `edge-route-catalog`: renders generic route-rule entries that can be compared mechanically to Traefik route names.
- `image-metadata`: renders image repositories, tags, pull policies, update eligibility, Keel policy annotations, match-tag behavior, trigger mode, and poll cadence.
- `kubernetes`: renders canonical `service-intent` workloads into app-local Kubernetes manifests under `platform/cluster/flux/apps/<group>/<service>/`.
- `nix-hosts`: renders fleet inventory into `platform/flake.nix`, generated NixOS host defaults, and generated k3s label modules.
- `vso`: renders Vault Secrets Operator references from `vault-dynamic-secrets` into CRs and namespace-local ServiceAccounts without secret values.
- `flux-root`: renders `clusters/<environment>/kustomization.yaml` plus ordered Flux `Kustomization` CRs in `kustomizations.yaml`. It infers layer sets from packs and service groups, including website-style `core/data/vso-secrets/edge/utility-system/mail/stateless` graphs and personal-stack-style optional `metallb-config`, `observability`, `grafana-dashboards`, and `media` layers. Dependencies are deterministic and can be overridden through `overrides["flux-root"].layers`.
- `flux-source`: renders Flux `HelmRepository`, OCI-style Helm repository, and `HelmRelease` manifests for known core/data packs and declared chart services. Known platform pack sources/releases are grounded in `platform-blueprints/packs/**`; declared charts can provide `source`, `chart`, `namespace`, `interval`, and `values`.
- `flux-packs`: composes known `platform-blueprints/packs/**` manifests into consumer-owned `platform/cluster/flux/apps/**` paths. It fills placeholders from platform data and substitutions, leaves source/release ownership to `flux-source`, rewrites the Gatus pack to consume the generated endpoints ConfigMap, and emits group `kustomization.yaml` files for copied pack directories.

### `kubernetes`

Input: canonical artifacts, primarily `service-intent`, with `fleet-inventory` placement data and `vault-dynamic-secrets` Secret targets.

Output: multi-file app directories under the configured GitOps apps root. The adapter emits `Deployment`, `StatefulSet`, `Job`, or `CronJob` manifests, colocated `Service` resources, optional `Namespace` and `ServiceAccount` resources, non-secret runtime `ConfigMap`s, static hostPath PV/PVC pairs, dynamic PVCs, `PodDisruptionBudget`s, and Prometheus `ServiceMonitor`/`PodMonitor` resources. Each service directory gets a deterministic `kustomization.yaml`.

Secret handling is reference-only. Kubernetes Secret inputs become `env.valueFrom.secretKeyRef`; VSO-backed inputs reference the destination Secret name produced by the Vault artifact. The Kubernetes adapter does not emit secret values.

### `vso`

Input: canonical `vault-dynamic-secrets`.

Output: `VaultConnection`, `VaultAuth`, `VaultStaticSecret`, `VaultDynamicSecret`, namespace-local `vault-secrets-operator` ServiceAccounts, and a `kustomization.yaml` under `platform/cluster/flux/apps/vso-secrets`. KV-v2 paths are normalized for VSO by stripping the configured mount prefix when needed.

The adapter only renders Vault mounts, paths, role names, destination Secret names, and rollout restart references. It does not render Vault seed data, database connection templates, SQL statements, RabbitMQ admin values, or any secret values.

### `nix-hosts`

Input: canonical `fleet-inventory`, plus deploy metadata from the expanded deploy config when available.

Output: `platform/flake.nix`, `platform/nix/hosts/<host>/default.nix`, and `platform/nix/generated/<host>-labels.nix`. Host roles map to `platform-blueprints.nixosModules.*` exports:

- `base` -> `base`
- `k3s-control-plane` and `control-plane` -> `roleControlPlane`
- `k3s-worker` and `worker` -> `roleWorker`
- `utility-host` / `utility` -> `roleUtilityHost`
- `gpu-amd` -> `roleGpuAmd`
- `gpu-nvidia` -> `roleGpuNvidia`
- `tailscale-network` -> `roleNetworkTailscale`
- `raspberry-pi-image` -> `roleRaspberryPiImage`

Generated host defaults guard host-specific modules with `builtins.pathExists ./overrides.nix` and `builtins.pathExists ./disko.nix`. The adapter intentionally does not create or overwrite host-specific override, hardware, networking, bootloader, filesystem, or disko modules.

## Follow-ups

Per-service special-casing must stay data-driven through route rules and probes. The Flux adapters intentionally generalize domains, namespaces, host selectors, chart versions, and image/source details through platform input and `overrides.*.substitutions`; downstream migrations and generated-output application remain outside this MVP.
