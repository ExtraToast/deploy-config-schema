# ADR 0001: Blueprint Pack Distribution

## Status

Accepted

## Context

The `flux-source` and `flux-packs` adapters need `platform-blueprints/packs/**`
content to render source/release manifests and consumer-owned Flux pack files.
The toolkit previously had no supported distribution path for those packs, and
machine-specific defaults are not acceptable because they make CI behavior
depend on a developer workstation layout.

`platform-blueprints` is already consumed by version tag/ref. Its release
workflow only echoes the tag, and existing ExtraToast GitHub workflow actions
consume platform-blueprints content by checking out that repository at a ref.
Private GitHub Packages access has also caused friction for `@extratoast`
packages, so adding a package-registry dependency would make pack resolution
less reliable for consumers.

## Decision

Consumers obtain packs by checking out `platform-blueprints` at a pinned tag or
ref, then point `deploy-config-schema` at that checkout explicitly with
`--blueprints-root <dir>` or `DEPLOY_CONFIG_BLUEPRINTS_ROOT`.

The toolkit has no implicit or default checkout path. The caller may also pass
`--blueprints-version <tag>`; that declared tag/ref is recorded in render plan
provenance so generated output can be traced back to the platform-blueprints
version used for pack resolution.

## Options Considered

1. Publish an npm or OCI artifact containing `packs/**`.
2. Bundle a pinned snapshot of `platform-blueprints` packs in this package.
3. Require the consumer to provide a pinned `platform-blueprints` checkout via
   an explicit root option.

## Rationale

Option 3 matches how `platform-blueprints` is already consumed: by tag/ref. It
also matches the existing GitHub workflow checkout pattern used by
ExtraToast/github-workflows actions for platform-blueprints content.

This avoids GitHub Packages authentication friction, works offline after the
pinned checkout exists in CI, and keeps rendering deterministic because the
checkout ref is controlled by the consumer.

## Consequences

Consumers must check out or vendor `platform-blueprints` at the desired tag
before rendering blueprint-backed adapters. CI should do this with a pinned
checkout step or pinned action ref, not a machine-specific absolute path.

If the root is missing or does not contain `packs/`, the CLI fails with a
structured diagnostic instead of silently rendering empty pack output.
