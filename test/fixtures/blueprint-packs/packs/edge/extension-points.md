# Edge Extension Points

Consumers should layer these resources next to the edge base:

- application `IngressRoute` resources generated from service intent
- service-specific middleware such as redirects or extra CSP relaxations
- route/probe catalog ConfigMaps
- optional dashboard exposure guarded by forward-auth, or the shared
  `packs/edge-middleware` dashboard resource with consumer substitutions

Keep CSP and dashboard exposure profile-driven. They are intentionally not
global defaults in the base `packs/edge` pack.
