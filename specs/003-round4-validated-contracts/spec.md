# Feature Specification: Round 4 Validated Schema Contracts

**Feature Branch**: `spec/round4-validated-contracts`  
**Feature Directory**: `specs/003-round4-validated-contracts`  
**Status**: Implementation  
**Created**: 2026-06-09

## Overview

Round 4 promotes the Round 3 design-first contracts into validated, usable schema artifacts. The package must validate standalone service-intent, fleet-inventory, and Vault dynamic-secret input files through the CLI, add semantic checks beyond JSON Schema shape, and allow service-intent documents to feed the existing route, probe, catalog, and image metadata adapters where the fields map cleanly to the Round 2 renderer model.

The package still does not own platform manifests. Kubernetes workload manifest rendering, Vault policy compilation, Flux/VSO resources, and Nomad job rendering remain out of scope. Nomad stays contract-only until representative input and expected-output fixtures exist.

## Functional Requirements

- FR-1: The CLI MUST validate `service-intent`, `fleet-inventory`, and `vault-dynamic-secrets` artifacts in addition to the existing deploy config document.
- FR-2: The service-intent validator MUST check cross-field semantics for workload kind, image, ports, routes, Gatus probes, observability monitors, storage mounts, Kubernetes hints, and Nomad contract status.
- FR-3: Service-intent files MAY render through the existing implemented adapters for generic route/probe/catalog/image metadata output when invoked explicitly as service-intent input.
- FR-4: Service-intent rendering MUST normalize only generic renderer data: exposure class, host label, backend service/port, health probe, extra Gatus probes, route rules, access class, adapter settings, and image metadata.
- FR-5: Service-intent fields that do not map to the existing Round 2 renderer, including workload manifests, env, secret mounting, storage resources, observability CRs, scheduling, rollout semantics, and Kubernetes contract hints, MUST be validate-only.
- FR-6: The fleet-inventory validator MUST check references among sites, nodes, capabilities, placement rules, origins, exposure classes, SSO policies, and renderer target selection.
- FR-7: The Vault dynamic-secret validator MUST check references among Kubernetes auth roles, KV paths, transit keys, database roles, RabbitMQ roles, VSO syncs, and service consumers.
- FR-8: The Vault dynamic-secret schema MUST remain input-only and MUST NOT compile policies, scripts, manifests, or runtime secret values.
- FR-9: Nomad MUST remain contract-only. The package MUST validate Nomad skeleton shape and reject any Nomad renderer status other than design-only.
- FR-10: Fixtures and tests MUST demonstrate valid standalone validation, semantic failures, service-intent rendering, generalized placeholder values, and unchanged deploy-config behavior.

## Success Criteria

- SC-1: `deploy-config-schema validate service-intent <file>` validates the service-intent fixture and returns structured diagnostics for semantic failures.
- SC-2: `deploy-config-schema validate fleet-inventory <file>` validates the fleet fixture and returns diagnostics for broken references.
- SC-3: `deploy-config-schema validate vault-dynamic-secrets <file>` validates the Vault fixture and returns diagnostics for broken references.
- SC-4: `deploy-config-schema render <adapter> <file> --input service-intent` renders implemented generic adapters from a renderable service-intent fixture.
- SC-5: No Nomad render adapter exists, and Nomad renderer status remains forced to `design_only`.
- SC-6: Local non-network test and validation commands pass.

## Boundaries

- No changes to `/workspace/personal-stack` or `/workspace/website`.
- No hardcoded consumer domains, hostnames, namespaces, IP addresses, image prefixes, vendor URLs, exchange names, queue names, or live paths in shared defaults.
- No Kubernetes workload renderer, Nomad renderer, Vault policy compiler, or platform manifest fork.
