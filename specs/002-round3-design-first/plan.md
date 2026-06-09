# Implementation Plan: Round 3 Design-First Schema Contracts

**Feature Directory**: `specs/002-round3-design-first`  
**Spec**: `specs/002-round3-design-first/spec.md`  
**Status**: Ready for skeleton implementation

## Technical Context

The existing package uses Node.js 20, JavaScript modules, Ajv 8 with JSON Schema 2020-12, YAML parsing, and Node's built-in test runner. Round 3 stays inside that stack. It adds schema and fixture skeletons plus direct tests; it does not add a renderer, a new CLI command, a networked build, or downstream repository changes.

## Architecture

- `schemas/round3/service-intent.schema.json`: standalone design-first service-intent schema for per-service special-casing and future Nomad contract inputs.
- `schemas/round3/fleet-inventory.schema.json`: standalone design-first fleet inventory extension schema for sites, nodes, capabilities, placement, origins, exposure, SSO, and renderer target selection.
- `schemas/round3/vault-dynamic-secrets.schema.json`: standalone design-first Vault input schema for Kubernetes auth roles, VSO syncs, KV paths, transit keys, database roles, RabbitMQ roles, and validation fixtures.
- `fixtures/round3/*.sample.yaml`: generalized fixtures that avoid reference repo values and validate against the matching schema.
- `test/round3-schemas.test.js`: Ajv tests that compile each schema, validate fixtures, check generalized placeholder values, and assert Nomad remains unimplemented.
- `scripts/validate-schema.js`: extended to compile every schema under `schemas/` while preserving the existing deploy-config schema validation path.
- `package.json`: includes `fixtures/` in the package file allow-list so the skeleton contracts and examples are distributed together.

## Requirement Mapping

| Requirement | Design element |
| --- | --- |
| FR-1 | `service-intent.schema.json` service profile, workload, runtime, networking, probes, observability, scheduling, rollout, Kubernetes, and Nomad sections. |
| FR-2 | Service fixture covers stateless, SPA, WebSocket route, cron, migration, stateful, sidecar, VSO, Vault dynamic, PVC, hostPath, monitor, and Gatus shapes through generic examples. |
| FR-3 | Fixture scanner in `test/round3-schemas.test.js` rejects known reference domains, hosts, IPs, image prefixes, and personal namespaces. |
| FR-4 | `fleet-inventory.schema.json` top-level sites, nodes, capabilities, placement, origins, exposure, sso, and renderer_targets. |
| FR-5 | `origin` definition models proxied_dns, direct_wan, direct_lan, internal_service, and custom kinds. |
| FR-6 | Capabilities and renderer targets are open identifiers with bounded target kinds and explicit status. |
| FR-7 | `vault-dynamic-secrets.schema.json` auth, kv, transit, database, rabbitmq, vso, service_consumers, and validation_fixtures sections. |
| FR-8 | Vault schema contains only input data; tests and docs prohibit generated policy/script output. |
| FR-9 | Nomad schema section requires `renderer_status: design_only` and implementation prerequisites. |
| FR-10 | `fixtures/round3/*.sample.yaml` validate with Ajv. |
| FR-11 | `test/round3-schemas.test.js` compiles schemas and validates fixtures. |
| FR-12 | No adapter modules are modified; existing CLI commands remain unchanged. |

## Verification

Local checks that do not require network:

- `npm run validate:schema`
- `npm test`
- `npm run validate:sample`
- `npm run render:sample`

The sandbox cannot run networked install/build commands. CI will run `npm ci` externally.

## Risks and Follow-ups

- These schemas intentionally stop before renderer semantics. Adding production renderers later requires fixture-backed expected outputs.
- Some cross-document references remain future semantic validation work because this round adds standalone schema skeletons only.
- The Vault policy compiler should be implemented in coordination with platform-blueprints so this package remains an input contract rather than a platform manifest generator.
