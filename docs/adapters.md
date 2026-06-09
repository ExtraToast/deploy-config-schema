# Adapter Status

The Round-2 MVP validates the full deploy config shape and implements the common renderer set for sample-backed platform output.

## Implemented

- `traefik-public`: renders public IngressRoute documents for `public` and `public_and_lan` Kubernetes services with backends.
- `traefik-lan`: renders LAN IngressRoute documents for `public_and_lan` and `lan_only` Kubernetes services with backends.
- `gatus`: renders a ConfigMap-compatible `endpoints.yaml` document for ingress and monitoring backends, supports HTTP/TCP conditions, applies SSO/TCP internal-probe defaults, and sorts by group/name.
- `edge-catalog`: renders service entries with cluster, service, exposure, access, and host fields.
- `edge-route-catalog`: renders generic route-rule entries that can be compared mechanically to Traefik route names.
- `image-metadata`: renders image repositories, tags, pull policies, update eligibility, Keel policy annotations, match-tag behavior, trigger mode, and poll cadence.
- `flux-root`: renders `clusters/<environment>/kustomization.yaml` plus ordered Flux `Kustomization` CRs in `kustomizations.yaml`. It infers layer sets from packs and service groups, including website-style `core/data/vso-secrets/edge/utility-system/mail/stateless` graphs and personal-stack-style optional `metallb-config`, `observability`, `grafana-dashboards`, and `media` layers. Dependencies are deterministic and can be overridden through `overrides["flux-root"].layers`.
- `flux-source`: renders Flux `HelmRepository`, OCI-style Helm repository, and `HelmRelease` manifests for known core/data packs and declared chart services. Known platform pack sources/releases are grounded in `platform-blueprints/packs/**`; declared charts can provide `source`, `chart`, `namespace`, `interval`, and `values`.
- `flux-packs`: composes known `platform-blueprints/packs/**` manifests into consumer-owned `platform/cluster/flux/apps/**` paths. It fills placeholders from platform data and substitutions, leaves source/release ownership to `flux-source`, rewrites the Gatus pack to consume the generated endpoints ConfigMap, and emits group `kustomization.yaml` files for copied pack directories.

## Follow-ups

Per-service special-casing must stay data-driven through route rules and probes. The Flux adapters intentionally generalize domains, namespaces, host selectors, chart versions, and image/source details through platform input and `overrides.*.substitutions`; downstream migrations and generated-output application remain outside this MVP.
