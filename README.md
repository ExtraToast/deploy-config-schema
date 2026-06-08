# deploy-config-schema

`@extratoast/deploy-config-schema` provides a JSON Schema and CLI contract for deploy and infrastructure config documents. The initial skeleton validates YAML or JSON config, renders deterministic Traefik IngressRoutes for the sample config, and exposes documented TODO stubs for the remaining adapters.

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
- `gatus`: TODO stub.
- `edge-catalog`: TODO stub.
- `edge-route-catalog`: TODO stub.
- `image-metadata`: TODO stub.

Stub adapters validate input and then return `E_ADAPTER_TODO` with exit code 2. See [docs/adapters.md](docs/adapters.md).

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
