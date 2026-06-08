# deploy-config-schema

`@extratoast/deploy-config-schema` provides a JSON Schema and CLI contract for deploy and infrastructure config documents. The Round-2 MVP validates YAML or JSON config and renders deterministic Traefik IngressRoutes, edge catalogs, Gatus endpoints, and image metadata audit output for the common Kubernetes platform case.

## Install

```bash
npm install @extratoast/deploy-config-schema
```

The package is published under the short ExtraToast npm coordinate. A brand-new GitHub Packages npm package on this personal account defaults private; the owner must set it public once after the first publish.

## Commands

Validate a config document:

```bash
npx deploy-config-schema validate samples/deploy-config.yaml
```

Render public Traefik IngressRoutes:

```bash
npx deploy-config-schema render traefik-public samples/deploy-config.yaml
```

Write rendered output to a path:

```bash
npx deploy-config-schema render traefik-public samples/deploy-config.yaml --output traefik-ingressroutes.yaml
```

Available adapters:

- `traefik-public`: implemented.
- `traefik-lan`: implemented.
- `gatus`: implemented.
- `edge-catalog`: implemented.
- `edge-route-catalog`: implemented.
- `image-metadata`: implemented.

See [docs/adapters.md](docs/adapters.md) for adapter scope and follow-ups.

## Local Development

```bash
npm ci
npm test
npm run validate:schema
npm run validate:sample
npm run render:sample
```

## Boundaries

This repository defines a versioned schema and command surface. It does not apply generated manifests, modify personal-stack or website, operate a cluster, manage secrets, or render Nomad jobs. personal-stack and website are first-class optional consumers that can adopt pinned package versions when their own repositories opt in.
