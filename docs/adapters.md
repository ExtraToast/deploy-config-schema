# Adapter Status

The initial skeleton validates the full deploy config shape and implements the Traefik IngressRoute adapter for sample-backed public and LAN output.

## Implemented

- `traefik-public`: renders public IngressRoute documents for `public` and `public_and_lan` Kubernetes services with backends.
- `traefik-lan`: renders LAN IngressRoute documents for `public_and_lan` and `lan_only` Kubernetes services with backends.

## Documented TODOs

- `gatus` traces FR-14 through FR-16 and SC-6 through SC-7. It must render ConfigMap-compatible endpoints for ingress and monitoring backends, support HTTP/TCP conditions, apply SSO/TCP internal-probe defaults, and sort by group/name.
- `edge-catalog` traces FR-17 and SC-8. It must render service entries with cluster, service, exposure, access, and host fields.
- `edge-route-catalog` traces FR-18 and SC-9. It must render generic route-rule entries that can be compared mechanically to Traefik route names.
- `image-metadata` traces FR-19 through FR-20 and SC-10. It must render image repositories, tags, pull policies, update eligibility, Keel policy annotations, match-tag behavior, trigger mode, and poll cadence.

Stub commands validate the input document and then return `E_ADAPTER_TODO` with exit code 2. This prevents consumers from treating deferred adapters as generated artifacts.
