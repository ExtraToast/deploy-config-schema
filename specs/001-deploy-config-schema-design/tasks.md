# Tasks: Deploy Config Schema Design

## Dependencies

- T001 must stay first because it aligns the spec with the requested skeleton scope.
- T002 must precede package code, tests, and workflow commands.
- T003 and T004 must precede semantic validation, adapter rendering, and sample checks.
- T005-T010 may be implemented in small vertical slices, but tests must pass before marking each slice complete.
- T011-T013 close documentation, automation, and verification.

## Phase 1: Planning and Contracts

- [x] T001 [FR-1..FR-27/SC-1..SC-12] Update `specs/001-deploy-config-schema-design/spec.md` and write `plan.md` so the skeleton scope, adapter TODOs, and non-deployment boundary are consistent.
- [x] T002 [FR-23/FR-24/FR-26/SC-11] Create npm package metadata in `package.json`, `package-lock.json`, `bin/deploy-config-schema.js`, and `.npmrc` using the short coordinate `@extratoast/deploy-config-schema`.
- [x] T003 [FR-1/FR-2/FR-5/FR-13/FR-15/FR-19/FR-21] Define the structural JSON schema in `schemas/deploy-config.schema.json`.
- [x] T004 [FR-1/FR-2/FR-9/FR-10/FR-12/FR-13/FR-19/FR-20/SC-1] Add `samples/deploy-config.yaml` representing non-secret fleet, ingress, monitoring, and image metadata concepts.

## Phase 2: Validation and CLI

- [x] T005 [FR-3/FR-4/FR-6/SC-2] Add validation tests in `test/validator.test.js` for valid input and required invalid cross-reference classes.
- [x] T006 [FR-5/FR-6] Implement YAML/JSON loading and schema diagnostics in `src/config-loader.js` and `src/validator.js`.
- [x] T007 [FR-3/FR-4/FR-12/FR-16/FR-20/SC-2] Implement semantic validation for references, duplicate exposure, missing host labels, WAN origins, probe constraints, and image rollout contradictions.
- [x] T008 [FR-6/FR-7] Implement `src/cli.js` with `validate` and `render <adapter>` commands, structured diagnostics, stdout, and `--output` support.

## Phase 3: Adapter MVP

- [x] T009 [FR-8/FR-9/FR-10/FR-11/FR-12/FR-13/SC-3/SC-4/SC-5] Implement and test deterministic Traefik public/LAN IngressRoute rendering in `src/adapters/traefik.js` and `test/traefik.test.js`.
- [x] T010 [FR-14/FR-15/FR-16/FR-17/FR-18/FR-19/FR-20/SC-3/SC-6..SC-10] Replace adapter stubs with implemented Gatus, edge catalog, edge route catalog, and image metadata renderers plus deterministic tests.

## Phase 4: Automation and Documentation

- [x] T011 [FR-22/FR-23/FR-25/FR-26/SC-11/SC-12] Update `README.md` with package usage, local commands, consumer boundaries, and package visibility note.
- [x] T012 [FR-23/FR-26] Update `.github/workflows/ci.yml`, add `.github/workflows/release.yml`, add `.github/workflows/publish-on-release.yml`, and add release-please manifests.
- [x] T013 [SC-1/SC-2/SC-3/SC-4/SC-5/SC-11/SC-12] Run local verification: `npm ci`, `npm test`, `npm run validate:schema`, `npm run validate:sample`, and `npm run render:sample`.
