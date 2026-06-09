# deploy-config-schema

`@extratoast/deploy-config-schema` provides a JSON Schema and CLI contract for deploy and infrastructure config documents. The Round-2 MVP validates YAML or JSON config and renders deterministic Traefik IngressRoutes, edge catalogs, Gatus endpoints, and image metadata audit output for the common Kubernetes platform case.

## Install

```bash
npm install @extratoast/deploy-config-schema
```

The package is published under the short ExtraToast npm coordinate. A brand-new GitHub Packages npm package on this personal account defaults private; the owner must set it public once after the first publish.

## Commands

Validate config and generated artifact documents:

```bash
npx deploy-config-schema validate deploy-config samples/deploy-config.yaml
npx deploy-config-schema validate platform fixtures/platform/single-node.platform.yaml
npx deploy-config-schema validate auto platform.yaml service-intent.yaml fleet-inventory.yaml vault-dynamic-secrets.yaml
```

`validate auto` infers the artifact kind from the file name and, when needed, from the top-level document shape. The JSON response is deterministic and CI-friendly:

```json
{
  "valid": true,
  "diagnostics": [],
  "results": [
    { "file": "platform.yaml", "kind": "platform", "valid": true, "diagnostics": [] }
  ]
}
```

Validate standalone generated artifacts explicitly:

```bash
npx deploy-config-schema validate service-intent fixtures/round4/service-intent-renderable.sample.yaml
npx deploy-config-schema validate fleet-inventory fixtures/round3/fleet-inventory.sample.yaml
npx deploy-config-schema validate vault-dynamic-secrets fixtures/round3/vault-dynamic-secrets.sample.yaml
```

Render a full generated tree from `platform.yaml`:

```bash
npx deploy-config-schema render-tree platform.yaml --output .
```

Check generated-file drift in CI without writing files:

```bash
npx deploy-config-schema render-tree platform.yaml --output . --check
npm run check-drift -- platform.yaml --output .
```

The check re-renders deterministically and exits nonzero with `E_RENDER_DIFF` if any managed generated file is missing or byte-different from the fresh render.

Render public Traefik IngressRoutes:

```bash
npx deploy-config-schema render traefik-public samples/deploy-config.yaml
```

Render generic route/probe/catalog/image outputs from service-intent input:

```bash
npx deploy-config-schema render gatus fixtures/round4/service-intent-renderable.sample.yaml --input service-intent
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
npm run validate:artifacts -- platform.yaml service-intent.yaml fleet-inventory.yaml vault-dynamic-secrets.yaml
npm run check-drift -- platform.yaml --output .
npm run render:sample
```

## Boundaries

This repository defines a versioned schema and command surface. It does not apply generated manifests, modify personal-stack or website, operate a cluster, manage secrets, or render Nomad jobs. personal-stack and website are first-class optional consumers that can adopt pinned package versions when their own repositories opt in.

Round 4 keeps Nomad contract-only: service-intent and fleet-inventory files may validate future Nomad input skeletons, but no Nomad renderer adapter is exposed. Vault dynamic-secret files are validated as compiler inputs only; policy compilation remains outside this package.
