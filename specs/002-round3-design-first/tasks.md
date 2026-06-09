# Tasks: Round 3 Design-First Schema Contracts

## Dependencies

- T001-T003 establish the spec-kit contract before adding skeleton files.
- T004-T006 are independent schema skeletons and may be implemented in parallel.
- T007 depends on matching schemas.
- T008-T010 provide validation and packaging checks.

## Phase 1: Spec-Kit Contract

- [x] T001 [FR-1..FR-12] Create `specs/002-round3-design-first/spec.md` for the round-3 design-first boundary.
- [x] T002 [FR-1..FR-12] Create `specs/002-round3-design-first/plan.md` mapping schema skeletons, fixtures, and tests.
- [x] T003 [FR-10/FR-11] Create `specs/002-round3-design-first/tasks.md` with skeleton implementation tasks.

## Phase 2: Schema Skeletons

- [x] T004 [FR-1/FR-2/FR-3/FR-9] Add `schemas/round3/service-intent.schema.json`.
- [x] T005 [FR-4/FR-5/FR-6] Add `schemas/round3/fleet-inventory.schema.json`.
- [x] T006 [FR-7/FR-8] Add `schemas/round3/vault-dynamic-secrets.schema.json`.

## Phase 3: Fixtures and Tests

- [x] T007 [FR-10/SC-1..SC-4] Add generalized sample fixtures under `fixtures/round3/`.
- [x] T008 [FR-11/SC-1..SC-5] Add Ajv fixture validation tests in `test/round3-schemas.test.js`.
- [x] T009 [SC-1..SC-3] Extend `scripts/validate-schema.js` to compile every schema under `schemas/`.
- [x] T010 [SC-4/SC-6] Include `fixtures/` in package files and run local non-network verification.
