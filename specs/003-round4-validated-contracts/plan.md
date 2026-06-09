# Implementation Plan: Round 4 Validated Schema Contracts

**Feature Directory**: `specs/003-round4-validated-contracts`  
**Spec**: `specs/003-round4-validated-contracts/spec.md`  
**Status**: Implemented in package code

## Technical Context

The repo uses Node.js 20, ESM, Ajv 2020-12, YAML parsing, and Node's built-in test runner with c8 coverage. Round 4 keeps that stack and does not add dependencies.

## Architecture

- `src/artifact-validator.js`: compiles standalone schemas and runs semantic validators for deploy config, service-intent, fleet-inventory, and Vault dynamic-secret artifacts.
- `src/service-intent-normalizer.js`: converts the generic renderable subset of service-intent into the existing deploy-config-shaped renderer model.
- `src/cli.js`: keeps `validate <config>` and `render <adapter> <config>` compatible, adds `validate <artifact-kind> <file>`, and adds `render ... --input service-intent`.
- `fixtures/round4/service-intent-renderable.sample.yaml`: compact fixture for the service-intent renderer bridge.
- `test/round4-artifacts.test.js`: validates CLI behavior, semantic diagnostics, and service-intent adapter output.

## Requirement Mapping

| Requirement | Implementation |
| --- | --- |
| FR-1 | CLI artifact-kind parsing and `validateArtifact`. |
| FR-2 | `validateServiceIntent` reference checks for ports, probes, storage, workload kind, renderer host labels, and Nomad status. |
| FR-3/FR-4 | `normalizeServiceIntentForRender` feeds existing adapters. |
| FR-5 | Non-renderer fields are validated but ignored by the normalizer. |
| FR-6 | `validateFleetInventory` checks cross references. |
| FR-7/FR-8 | `validateVaultDynamicSecrets` checks references and TTL ordering without compiling outputs. |
| FR-9 | Schema const plus semantic Nomad checks; no Nomad adapter is added. |
| FR-10 | Round 4 fixture and tests; existing Round 3 fixture tests remain. |

## Verification

Allowed local checks:

- `npm run validate:schema`
- `npm run validate:sample`
- `npm test`

Networked install/build, Docker, kubeconform, Nix, and remote Git operations are intentionally not run in the sandbox.
