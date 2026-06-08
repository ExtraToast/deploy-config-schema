# Feature Specification: Deploy Config Schema Design

**Feature Branch**: `spec/initial`
**Feature Directory**: `specs/001-deploy-config-schema-design`
**Status**: Draft
**Created**: 2026-06-08

## Overview

ExtraToast/deploy-config-schema defines a design-only contract for a JSON-schema-driven deploy and infrastructure configuration artifact. The artifact is intended to describe fleet, service, exposure, access, ingress, monitoring, and image rollout intent once platform boundaries are proven outside this repository.

The design is based on the current personal-stack fleet inventory, platform tooling, and render scripts, with website used as a read-only compatibility reference for version metadata, Kubernetes GitOps deployment, and Keel-managed image rollouts. The desired outcome is a versioned schema plus command surface that downstream repositories can consume to validate declarative config and generate operational artifacts without copying downstream-specific render logic.

This repository is distributed as a versioned artifact. personal-stack and/or website consume pinned versions through Renovate. personal-stack remains continuously auto-deployed from its own repository and is not converted into a versioned product. Published coordinates must stay short and must not use doubled plugin-marker names.

This feature is a specification only. It must not define runnable code, generated manifests, downstream repository changes, release automation, or a migration plan that applies generated output.

## User Scenarios

### Scenario 1: Validate deployment intent before rendering

A platform maintainer edits a declarative deploy config modeled after personal-stack's fleet inventory. The config is validated against the published JSON schema before any adapter output is generated. Invalid references, duplicate service classifications, unsupported exposure modes, and malformed backend definitions are reported with stable diagnostics that identify the offending path.

### Scenario 2: Generate edge ingress artifacts from one source of truth

A downstream repository consumes a pinned deploy-config-schema artifact and runs a CLI command against its deploy config. The Traefik adapter produces public and LAN IngressRoute manifests that reflect exposure intent, access intent, host labels, root redirects, route exceptions, backend service targets, and WAN origin overrides.

### Scenario 3: Generate status and edge catalog artifacts

A downstream repository runs the Gatus and edge catalog adapters against the same validated config. The generated outputs describe service exposure, access class, hostnames, route rules, internal and external health probes, HTTP and TCP checks, and monitoring-only endpoints without requiring separate manually maintained catalog files.

### Scenario 4: Describe image rollout metadata consistently

A downstream repository records image metadata for first-party and third-party workloads in the deploy config. The image metadata adapter reports image names, tag strategy, pull policy, Keel annotations, and poll cadence so the current latest-tag rollout behavior can be audited and generated consistently where a consumer opts in.

### Scenario 5: Consume the artifact through pinned versions

personal-stack and/or website depend on the published deploy-config-schema artifact using short coordinates pinned by Renovate. Updating the schema or CLI is a dependency update in the consumer repository, not a change to the consumer's own deployment versioning model.

## Functional Requirements (FR-n)

- FR-1: The JSON schema must define a top-level deploy config document with version, cluster, sites, nodes, service intent, placement intent, exposure intent, access intent, ingress intent, monitoring intent, image metadata, and adapter output intent.
- FR-2: The schema must support the current personal-stack inventory concepts: cluster public domain, Kubernetes bootstrap metadata, site networking, node status, node roles, node capabilities, GPU placement preferences, service groups, public/LAN/internal exposure classes, SSO protection, host labels, root redirects, Kubernetes backend references, health endpoints, extra probes, and WAN origin overrides.
- FR-3: The schema must validate cross-references between services, sites, nodes, exposure entries, placement entries, access entries, backend entries, monitoring entries, host labels, image metadata, and adapter output selections.
- FR-4: The schema must reject duplicate or contradictory service classifications, including a service listed in more than one exposure class or an external route requested for a service without a host label.
- FR-5: The schema must allow YAML and JSON source documents to be validated against the same JSON schema contract.
- FR-6: The CLI contract must include a validation command that returns success for valid input and structured diagnostics for invalid input, including a stable code, a human-readable message, and the config path involved.
- FR-7: The CLI contract must include adapter commands that can write deterministic output to stdout and, when requested by the consumer, to a configured output path.
- FR-8: Adapter output must be deterministic: equivalent input must produce stable ordering, stable document separators, stable names, and no timestamps or machine-local paths.
- FR-9: The Traefik adapter must generate public IngressRoute documents for services in `public` and `public_and_lan` exposure classes that also have Kubernetes backend definitions.
- FR-10: The Traefik adapter must generate LAN IngressRoute documents for services in `public_and_lan` and `lan_only` exposure classes that also have Kubernetes backend definitions.
- FR-11: The Traefik adapter must model ingress class, namespace, route name, host match, path prefixes, exact paths, excluded paths, backend namespace, backend service, backend port, TLS, root redirect middleware, SSO middleware, and external DNS target annotations.
- FR-12: The Traefik adapter must support WAN origin overrides equivalent to `home_direct` and `edge_direct`, including whether the generated DNS target is proxied or direct.
- FR-13: The route model must represent path-specific route exceptions without hard-coding service names in the schema, including split API/UI hosts, unauthenticated health paths, and token-protected non-browser paths.
- FR-14: The Gatus adapter must generate a ConfigMap-compatible endpoints document for ingress backends and monitoring-only backends.
- FR-15: The Gatus adapter must support HTTP and TCP probes, explicit health paths, probe ports that differ from route ports, expected status codes, response time conditions, internal probes, external probes, combined internal/external probes, service groups, and extra probes.
- FR-16: The Gatus adapter must default SSO-protected HTTP services and TCP services to internal probing unless the config explicitly requests another probe strategy.
- FR-17: The edge catalog adapter must generate a service catalog with cluster name, service name, exposure class, access class, and fully qualified host when a host label exists.
- FR-18: The edge route catalog adapter must generate route entries with route name, owning service, host, access class, path prefixes, exact paths, excluded path prefixes, and excluded exact paths.
- FR-19: The image metadata adapter must represent container image repository, tag, pull policy, update eligibility, Keel policy annotations, match-tag behavior, trigger mode, and poll schedule.
- FR-20: The image metadata model must distinguish first-party latest-tag workloads from pinned third-party workloads so generated or audited Keel metadata does not mark pinned images for unintended rollout.
- FR-21: The design must reserve a future extension area for Nomad job inputs without requiring Nomad schema fields or rendering support in this feature.
- FR-22: The design must state that platform boundary proof is a prerequisite for implementation work; this repository must not drive live platform changes before that proof exists.
- FR-23: The distribution design must allow personal-stack and/or website to consume versioned artifacts through Renovate-pinned dependency coordinates while personal-stack remains continuously auto-deployed and unversioned as an application.
- FR-24: The distribution design must require short artifact coordinates and must forbid doubled plugin-marker names.
- FR-25: The primary first-class consumer set is [NEEDS CLARIFICATION]: personal-stack only, website only, or both personal-stack and website.
- FR-26: The first published artifact format and coordinate ecosystem are [NEEDS CLARIFICATION]: Gradle/Maven artifact, package registry artifact, OCI artifact, or more than one artifact type.
- FR-27: The compatibility promise for route exception behavior is [NEEDS CLARIFICATION]: exact parity with current personal-stack special cases, or a generic route-rule model that can represent the known cases without preserving every current name.

## Success Criteria (SC-n, measurable)

- SC-1: A config equivalent to the non-secret portions of personal-stack's current fleet inventory can be represented by the schema with zero validation errors.
- SC-2: At least one invalid fixture for each required cross-reference class fails validation: missing site, missing node, missing service, missing backend, missing host label, duplicate exposure entry, and unsupported health probe type.
- SC-3: Running the same adapter twice against the same valid input produces byte-for-byte identical output for Traefik, Gatus, edge catalog, edge route catalog, and image metadata.
- SC-4: The Traefik public output includes only services that are public or public-and-LAN and have Kubernetes backends; the LAN output includes only services that are public-and-LAN or LAN-only and have Kubernetes backends.
- SC-5: Every generated Traefik route includes ingress class, host match, backend namespace, backend service, backend port, TLS configuration, and required middleware or DNS annotations when applicable.
- SC-6: The Gatus output includes one endpoint for every eligible ingress backend and monitoring backend, plus every declared extra probe, sorted by group and endpoint name.
- SC-7: HTTP Gatus endpoints include status and response time conditions, while TCP endpoints include a connection condition.
- SC-8: The edge catalog output contains one entry for every service with exposure intent and includes exposure, access, and host fields where applicable.
- SC-9: The edge route catalog output contains all declared route rules and can be compared mechanically to generated Traefik route names.
- SC-10: The image metadata output identifies all configured images, separates latest-tag Keel-managed workloads from pinned third-party workloads, and reports poll cadence for every Keel-managed workload.
- SC-11: The distribution section can name valid short coordinates that a Renovate rule can pin without causing doubled plugin-marker names.
- SC-12: No generated output, downstream repository edit, live deployment action, or Nomad job rendering is required to complete this design-only feature.

## Assumptions

- Source config may be authored as YAML or JSON, but validation is governed by the JSON schema.
- The current personal-stack fleet inventory is the seed domain model, not a mandate to preserve its exact file shape.
- website is a compatibility reference for production GitOps and Keel behavior, not a writable target during this feature.
- Adapter outputs are text artifacts suitable for GitOps repositories.
- Secrets, token values, certificate material, and runtime credentials are not represented in the schema.
- The schema version is independent from personal-stack's deployment cadence.
- Renovate can pin the deploy-config-schema artifact in downstream repositories without changing their release model.
- Nomad support is reserved for a later feature after Kubernetes-oriented boundaries are stable.

## Edge Cases

- A service appears in more than one exposure class.
- A service has a host label but no backend for a requested route adapter.
- A service requests public exposure without a host label.
- A public route has a WAN origin override but the referenced site has no WAN IP.
- A LAN route is requested when no LAN ingress site or class exists.
- A health probe port differs from the routed service port.
- A TCP probe declares an HTTP-only expectation.
- An SSO-protected service requests external probing without an explicit probe strategy.
- A root host label maps to the bare public domain instead of a subdomain.
- Route include and exclude rules overlap.
- A route exception creates a duplicate route name after LAN suffixing.
- A first-party image uses a pinned tag while Keel metadata requests latest-tag matching.
- A third-party pinned image is accidentally marked for automatic rollout.

## Key Entities

- Deploy Config: Versioned source document containing cluster, fleet, service, route, monitor, and image intent.
- Cluster: Public domain and Kubernetes-level metadata needed by adapters.
- Site: Physical or virtual location with networking data such as LAN ingress and WAN origin addresses.
- Node: Managed host with status, site, architecture, roles, capacity, GPU data, and capabilities.
- Service: Named deployable or monitored unit referenced by placement, exposure, access, ingress, monitoring, and image metadata.
- Exposure Policy: Public, public-and-LAN, internal-only, or LAN-only reachability classification for a service.
- Access Policy: SSO, direct, cluster-internal, host label, and root redirect intent.
- Ingress Backend: Kubernetes namespace, service name, service port, health endpoint, and extra probe definitions for routeable workloads.
- Monitoring Backend: Kubernetes backend used only for status checks, not external ingress.
- Route Rule: Host and path matching contract used by edge route catalog and Traefik adapters.
- Health Probe: HTTP or TCP check definition with path, port, expected status, probe strategy, and response constraints.
- Edge Catalog: Generated service inventory describing exposure, access, and host data.
- Edge Route Catalog: Generated route inventory describing service routes before conversion to Traefik resources.
- Image Metadata: Declarative image identity and rollout-policy data for audit or generation.
- Artifact Coordinate: Published dependency identifier used by downstream repositories.
- Consumer Project: Repository that validates config or generates artifacts using a pinned deploy-config-schema version.
- Future Nomad Input: Reserved extension concept for later job-rendering support.

## Out of Scope

- Implementing the JSON schema, CLI, adapters, tests, package publishing, or release automation.
- Modifying personal-stack, website, or any other downstream repository.
- Applying generated manifests to a cluster.
- Replacing current personal-stack render scripts during this design-only feature.
- Installing, configuring, or operating Traefik, Gatus, Keel, Flux, Renovate, Kubernetes, Nomad, or DNS providers.
- Building, publishing, or deploying container images.
- Managing secrets, credentials, certificates, or runtime tokens.
- Rendering Nomad job files or validating full Nomad job specifications.
- Defining complete workload manifests beyond the adapter outputs named in this specification.
