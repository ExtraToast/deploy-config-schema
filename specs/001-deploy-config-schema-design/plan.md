# Implementation Plan: Deploy Config Schema Design

**Feature Directory**: `specs/001-deploy-config-schema-design`
**Spec**: `specs/001-deploy-config-schema-design/spec.md`
**Status**: Ready for tasks

## Technical Context

The initial artifact is an npm package named `@extratoast/deploy-config-schema`. The package uses Node.js 20, plain JavaScript modules, Ajv 8 for JSON Schema 2020-12 validation, and `yaml` for YAML/JSON source parsing and deterministic YAML output. This keeps the package small, avoids a compile step, and matches the initial distribution requirement without adding a Maven or OCI artifact.

The command entrypoint is `deploy-config-schema`. It validates YAML or JSON config documents against `schemas/deploy-config.schema.json`, then applies semantic validation for cross-reference rules that are not practical to express portably in JSON Schema. Diagnostics are stable JSON objects with `code`, `message`, and `path`.

Release automation uses release-please for version tags and a separate npm publish workflow for GitHub Packages. The first package publish on this personal account will default private and requires the owner to set package visibility public once.

## Architecture

- `schemas/deploy-config.schema.json`: structural schema for version, cluster, sites, nodes, service intent, placement, exposure, access, ingress, monitoring, image metadata, adapter output intent, and reserved future extensions.
- `src/config-loader.js`: YAML/JSON parsing with deterministic input errors.
- `src/validator.js`: Ajv schema validation plus semantic reference validation for sites, nodes, services, exposure classes, host labels, backends, probes, WAN overrides, and image rollout metadata.
- `src/adapters/traefik.js`: implemented Traefik public/LAN IngressRoute renderer for sample-backed Kubernetes services.
- `src/adapters/stubs.js`: deterministic TODO diagnostics for Gatus, edge catalog, edge route catalog, and image metadata adapters.
- `src/cli.js` and `bin/deploy-config-schema.js`: command parsing for `validate` and `render <adapter>`, stdout output, `--output` writes, and stable exit codes.
- `samples/deploy-config.yaml`: non-secret representative sample based on the personal-stack inventory concepts.
- `test/`: Node test runner coverage for schema validation, semantic diagnostics, CLI behavior, deterministic Traefik output, and adapter stubs.
- `.github/workflows/ci.yml`: real gating jobs for npm install/test/sample validation, ending in `Pipeline Complete`.
- `.github/workflows/release.yml` and `.github/workflows/publish-on-release.yml`: release-please and npm publication.

## Requirement Mapping

| Requirement | Design element |
| --- | --- |
| FR-1 | Top-level schema properties and required sections in `deploy-config.schema.json`. |
| FR-2 | Schema definitions for public domain, Kubernetes bootstrap data, sites, nodes, GPU preferences, service groups, exposure classes, SSO, host labels, redirects, Kubernetes backends, health probes, and WAN overrides. |
| FR-3 | `src/validator.js` semantic reference checks across sites, nodes, services, placement, access, backends, monitoring, host labels, image metadata, and adapter selections. |
| FR-4 | Duplicate service classification checks across Kubernetes service groups and exposure classes; external route host-label checks. |
| FR-5 | `src/config-loader.js` parses YAML and JSON before schema validation. |
| FR-6 | `validate` command returns JSON diagnostics with stable `code`, `message`, and `path`. |
| FR-7 | `render <adapter>` supports stdout by default and `--output <path>` for deterministic file writes. |
| FR-8 | Renderer sorts services/routes by stable keys and emits no timestamps or machine-local paths. |
| FR-9 | `traefik-public` renders `public` and `public_and_lan` services that have Kubernetes backends. |
| FR-10 | `traefik-lan` renders `public_and_lan` and `lan_only` services that have Kubernetes backends. |
| FR-11 | Traefik route renderer emits ingress class, namespace, route name, host match, path rules, backend service target, TLS, redirect/SSO middleware, and DNS annotations. |
| FR-12 | WAN origin overrides map `home_direct` and `edge_direct` to direct DNS targets from matching site WAN IPs. |
| FR-13 | `ingress_intent.route_rules` provides a generic route-rule model with include/exclude path fields and per-route access override. |
| FR-14 | Gatus command stub exists and validates input; full ConfigMap-compatible output is a documented TODO. |
| FR-15 | Probe schema models HTTP/TCP, health paths, alternate ports, status codes, response time, internal/external/both strategies, groups, and extra probes. |
| FR-16 | Gatus strategy defaults are documented as TODO behavior in adapter docs and stub diagnostics. |
| FR-17 | Edge catalog command stub exists and validates input; full catalog output is a documented TODO. |
| FR-18 | Edge route catalog command stub exists and validates input; route-rule schema is shared with Traefik. |
| FR-19 | Image metadata schema models repository, tag, pull policy, update eligibility, Keel policy, match-tag, trigger mode, and poll schedule. |
| FR-20 | Image semantic validation rejects pinned images marked for latest-tag rollout and third-party images marked auto-update eligible. |
| FR-21 | `extensions.nomad` reserves a future extension area without rendering support. |
| FR-22 | README/spec state that generated output is not applied and platform boundary proof remains prerequisite for live changes. |
| FR-23 | Package metadata and release docs identify pinned npm consumption by personal-stack and website. |
| FR-24 | Package coordinate is short and no doubled marker coordinate is introduced. |
| FR-25 | README names personal-stack and website as optional consumer references without modifying either repository. |
| FR-26 | `package.json` publishes `@extratoast/deploy-config-schema` to GitHub Packages with schema and CLI entrypoints. |
| FR-27 | Route rules are generic and do not hard-code service names in the schema or renderer. |

## Success Mapping

- SC-1: The sample config represents non-secret personal-stack inventory concepts and must validate locally and in the pipeline.
- SC-2: Unit tests cover missing site, missing node, missing service, missing backend, missing host label, duplicate exposure, and unsupported probe type diagnostics.
- SC-3: Tests run Traefik render twice and compare byte-for-byte output; stub adapters return deterministic TODO diagnostics.
- SC-4 and SC-5: Traefik tests assert public/LAN inclusion and required route fields.
- SC-6 through SC-10: Stub adapters and `docs/adapters.md` preserve the contract and TODO trace for later full rendering.
- SC-11: Package and README name `@extratoast/deploy-config-schema`.
- SC-12: No downstream edits, live deployment action, or Nomad rendering is part of this branch.

## Verification

Local checks:

- `npm ci`
- `npm test`
- `npm run validate:schema`
- `npm run validate:sample`
- `npm run render:sample`

Pipeline checks run the same commands and aggregate through `Pipeline Complete`.

## Risks and Follow-ups

- JSON Schema alone cannot express all cross-document references portably, so semantic validation is part of the CLI contract.
- Gatus, edge catalog, edge route catalog, and image metadata commands intentionally stop with TODO diagnostics until their full renderers are implemented.
- The Traefik skeleton covers IngressRoute output only; applying manifests and consumer migration are outside this repository.
