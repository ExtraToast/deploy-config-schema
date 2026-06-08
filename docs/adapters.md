# Adapter Status

The Round-2 MVP validates the full deploy config shape and implements the common renderer set for sample-backed platform output.

## Implemented

- `traefik-public`: renders public IngressRoute documents for `public` and `public_and_lan` Kubernetes services with backends.
- `traefik-lan`: renders LAN IngressRoute documents for `public_and_lan` and `lan_only` Kubernetes services with backends.
- `gatus`: renders a ConfigMap-compatible `endpoints.yaml` document for ingress and monitoring backends, supports HTTP/TCP conditions, applies SSO/TCP internal-probe defaults, and sorts by group/name.
- `edge-catalog`: renders service entries with cluster, service, exposure, access, and host fields.
- `edge-route-catalog`: renders generic route-rule entries that can be compared mechanically to Traefik route names.
- `image-metadata`: renders image repositories, tags, pull policies, update eligibility, Keel policy annotations, match-tag behavior, trigger mode, and poll cadence.

## Follow-ups

Per-service special-casing must stay data-driven through route rules and probes. Nomad inputs, live downstream migrations, and generated-output application remain outside this MVP.
