# Feature Specification: Round 3 Design-First Schema Contracts

**Feature Branch**: `spec/round3-design-first`  
**Feature Directory**: `specs/002-round3-design-first`  
**Status**: Design-first skeleton  
**Created**: 2026-06-09

## Overview

Round 3 extends the deploy-config-schema contract without adding a new production renderer. The goal is to define schema areas and fixture skeletons for deployment intent that was too service-specific for the round-2 fleet renderer: service-level workload exceptions, richer fleet inventory, renderer target selection, and Vault bootstrap/dynamic-secret inputs.

This is design-first only. The existing round-2 renderer core for Traefik, Gatus, edge catalogs, and image metadata remains the only implemented renderer surface. Nomad is reserved as a future renderer contract because the reference repositories do not contain representative Nomad job fixtures. Vault bootstrap and dynamic-secret material is represented as input shape only; policy compiler and platform manifests belong in coordinated platform-blueprints work.

## User Scenarios

### Scenario 1: Model service-specific deployment intent without renderer branches

A platform maintainer wants to describe a stateless API, a SPA, a WebSocket replica, a media app, a mail service, or a cron/migration job using typed fields for workload kind, env, secrets, storage, networking, probes, observability, scheduling, and rollout policy. The schema records the exceptional intent without requiring a hardcoded service-name branch.

### Scenario 2: Select renderer targets from a generalized fleet inventory

A consumer describes sites, nodes, capabilities, placement, origins, exposure, SSO, and renderer targets using project-neutral labels and domains. Renderers can later choose Kubernetes, Nomad, catalog, probe, or audit targets from the same inventory contract without relying on personal-stack or website names.

### Scenario 3: Coordinate Vault dynamic-secret inputs

A platform maintainer describes Kubernetes auth roles, VSO static secret syncs, KV paths, transit keys, database dynamic roles, RabbitMQ dynamic roles, and validation fixtures as schema inputs. A later platform-blueprints policy compiler can consume those inputs, but this repository does not copy bootstrap scripts or generate Vault policies in round 3.

### Scenario 4: Reserve Nomad safely

A future service can declare a Nomad renderer target and provide an input skeleton for datacenters, task groups, drivers, resources, services, checks, templates, volumes, restart, and update policy. The current package validates the skeleton schema only; it does not render Nomad jobs.

## Functional Requirements

- FR-1: Provide a service-intent schema skeleton for workload kind, image, ports, probes, env, secrets, storage, networking, route overrides, Gatus probes, observability, scheduling, rollout behavior, Kubernetes contract hints, and future Nomad contract hints.
- FR-2: The service-intent schema MUST support generic service special-casing categories seen in the reference repos: stateless apps, SPAs, WebSocket/direct-origin routes, one-shot jobs, cron jobs, PVC/hostPath state, VSO mirrored secrets, Vault dynamic creds, sidecars/init containers, ServiceMonitor/PodMonitor, and Gatus endpoint intent.
- FR-3: The service-intent schema MUST NOT hardcode consumer domains, hostnames, exchange names, queue names, image prefixes, vendor URLs, namespaces, filesystem paths, or service names.
- FR-4: Provide a fleet inventory extension schema skeleton for sites, nodes, capabilities, placement, origins, exposure, SSO, and renderer target selection.
- FR-5: The fleet inventory extension MUST replace fixed origin names with typed origin objects that can represent proxied DNS, direct WAN, direct LAN, and custom provider-specific behavior without assuming Cloudflare or Traefik.
- FR-6: The fleet inventory extension MUST support arbitrary capability labels and renderer targets instead of personal-stack-specific labels or static output selections.
- FR-7: Provide a Vault dynamic-secret input schema skeleton for Kubernetes auth roles, VSO roles, KV paths, transit keys, database dynamic credentials, RabbitMQ dynamic credentials, service credential consumption, and validation fixtures.
- FR-8: The Vault schema MUST coordinate with platform-blueprints by describing inputs only; it MUST NOT include copied bootstrap scripts, generated HCL, generated Kubernetes manifests, or runtime secret values.
- FR-9: The Nomad contract area MUST describe future input shape and implementation prerequisites, and MUST state that no Nomad renderer is implemented until representative Nomad fixtures exist.
- FR-10: Add fixtures that validate against each round-3 schema and use generalized placeholder values.
- FR-11: Add tests that compile the round-3 schemas and validate the fixture skeletons.
- FR-12: Existing round-2 renderer behavior and sample output MUST remain unchanged except for package metadata needed to include the new skeleton artifacts.

## Success Criteria

- SC-1: `schemas/round3/service-intent.schema.json` compiles as JSON Schema 2020-12 and validates `fixtures/round3/service-intent.sample.yaml`.
- SC-2: `schemas/round3/fleet-inventory.schema.json` compiles as JSON Schema 2020-12 and validates `fixtures/round3/fleet-inventory.sample.yaml`.
- SC-3: `schemas/round3/vault-dynamic-secrets.schema.json` compiles as JSON Schema 2020-12 and validates `fixtures/round3/vault-dynamic-secrets.sample.yaml`.
- SC-4: The fixture files contain no hardcoded reference-domain values, reference-host values, reference IP addresses, personal namespace names, or reference repository image prefixes.
- SC-5: Tests assert that the round-3 service-intent schema rejects accidental production renderer enablement for Nomad.
- SC-6: The package continues to pass the existing test and schema validation commands where local sandbox constraints allow them.

## Assumptions

- Round-2 renderer outputs remain authoritative for currently implemented Kubernetes route, probe, catalog, and image metadata behavior.
- Service-intent and fleet-inventory round-3 schemas are published skeleton contracts and may evolve before production rendering is added.
- Consumer-authored YAML and JSON continue to be validated through JSON Schema.
- Platform-blueprints owns Vault bootstrap packs, Flux/VSO resources, and policy compiler implementation.
- Nomad support requires representative Nomad input and expected-output fixtures before renderer implementation.
- Secrets, tokens, passwords, private keys, and live credential values are never represented in fixtures.

## Edge Cases

- A service declares a future Nomad target with `renderer_status: implemented`.
- A route override points to a direct origin but the fleet origin lacks an address source.
- A storage mount has no matching volume declaration.
- A dynamic database role lacks creation or revocation statement templates.
- A RabbitMQ role grants wildcard permissions without declaring the vhost scope.
- A VSO sync references a KV path not declared in the Vault input model.
- A service selects an SSO policy that is not declared by the fleet inventory.
- A renderer target selects an unsupported target kind.

## Key Entities

- Service Intent Document: A collection of service profiles with workload, runtime, networking, observability, scheduling, and future renderer contract hints.
- Service Profile: A generic declaration for one deployable or monitored unit.
- Workload Contract: The non-rendering shape for Deployment, StatefulSet, Job, CronJob, external service, host-native, and future Nomad workloads.
- Fleet Inventory Extension: A richer inventory contract for sites, nodes, capabilities, placement, origins, exposure, SSO, and renderer target selection.
- Origin: A typed route target decision such as proxied DNS, direct WAN, direct LAN, internal service, or provider-specific extension.
- Renderer Target: A declared downstream output family and status, such as Kubernetes routes, Gatus probes, catalogs, image audit, Vault policy inputs, or future Nomad jobs.
- Vault Dynamic Secret Inputs: Declarative inputs for auth roles, policy scopes, KV paths, transit keys, database roles, RabbitMQ roles, VSO syncs, and service consumption.
- Future Nomad Contract: Reserved input area for datacenters, task groups, tasks, services, checks, templates, volumes, restart, and update policy.

## Out of Scope

- Implementing a new Kubernetes special-case renderer.
- Implementing a Nomad renderer or validating full Nomad HCL.
- Replacing the round-2 fleet renderer core.
- Copying personal-stack or website manifests, scripts, policies, queue names, domains, namespaces, or paths.
- Generating Vault policies, Vault bootstrap commands, VSO manifests, or dynamic-secret role commands.
- Modifying `/workspace/personal-stack` or `/workspace/website`.
