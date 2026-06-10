# Edge Middleware Pack

This pack contains Traefik middleware and dashboard primitives that consumers
can layer onto an edge deployment:

- forward-auth middleware
- security/response headers
- named CSP profiles
- local certificate file-provider ConfigMap
- dashboard `IngressRoute` guarded by an auth/header chain

Every environment-specific value is a Flux substitution placeholder. Consumers
can omit resources they do not want by layering their own kustomization.
