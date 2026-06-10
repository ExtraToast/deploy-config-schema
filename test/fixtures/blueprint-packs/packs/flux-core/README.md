# Flux Core Pack

Parameterized Flux bases for CRD-owning cluster components:

- `cert-manager`
- `external-dns-cloudflare`
- `traefik-public`
- `traefik-lan`
- `metallb`
- `vso`

These manifests are intended to be consumed through Flux `postBuild.substitute`,
kustomize replacements, or a repository-local renderer. Consumers provide every
namespace, domain filter, ACME email, token secret name, node selector, and
service-mode choice.

The pack owns platform primitives only. Application `IngressRoute` resources,
service-specific middleware, and concrete DNS names stay in consumer repos.
