# Edge Pack

Parameterized edge primitives for Flux-managed Traefik clusters:

- Cloudflare DNS-01 `ClusterIssuer`
- default Traefik `TLSStore`
- forward-auth middleware
- extension placeholders for consumer-owned routes and service-specific middleware

The pack intentionally does not include application `IngressRoute` resources.
Route catalogs and probe endpoint ConfigMaps are expected to come from a
consumer renderer such as `deploy-config-schema`.

Use `packs/edge-middleware` for named CSP/header profiles, local certificate
file-provider config, and dashboard exposure.
