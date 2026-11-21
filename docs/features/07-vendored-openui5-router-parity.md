# Vendored OpenUI5 Router Parity Suite

> **Status**: Implemented (PR #33). See [docs/reference/upstream-parity.md](../reference/upstream-parity.md) for the contract and the [folder README](../../packages/lib/test/qunit/upstream-parity/README.md) for the layout, rules, scripts and version-bump steps.

**Goal**: port selected public OpenUI5 `sap.m.routing.Router` tests into this repository, run them against both the native router and `ui5.guard.router.Router` with no guards registered, and so check drop-in compatibility against the framework's own expectations.

## Problem

The library extends `sap.m.routing.Router` and claims to be a drop-in replacement. The local differential suite in `packages/lib/test/qunit/parity/native/` compares the two routers, but this project wrote all of its cases. It cannot answer a stricter question:

> Does `ui5.guard.router.Router` still behave like the native router when measured against the framework's own public-router tests?

Pinned upstream tests give a second, external reference point:

1. **Compatibility**: the library overrides router behavior. Upstream tests check that inherited behavior stays aligned with OpenUI5 when no guards are active.
2. **Maintainability**: a refactor can keep the library's own tests green and still drift from upstream expectations.
3. **UI5 version changes**: a pinned upstream lane shows behavioral deltas when the development UI5 version changes.
4. **Honest documentation**: the docs can separate native compatibility (no guards) from guard behavior (intentionally different), with evidence.

## Decisions

| Decision                                                     | Reason                                                                                                                                                                                 |
| ------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Selected, pinned, public tests only                          | A curated subset keeps maintenance low. SAP-internal or unpublished framework tests are out of scope.                                                                                  |
| Vendored into the repo, never fetched in CI                  | CI stays reproducible. Maintainer scripts do the fetching.                                                                                                                             |
| Raw files are byte-for-byte upstream copies                  | Upstream diffs stay reviewable; provenance lives in the manifest and the port headers instead.                                                                                         |
| Executable adaptations in `ports/` and `adapters/`           | Local changes stay in one place, outside the raw files. Ports stay thin.                                                                                                               |
| Native-parity contract only (no guards)                      | Guard behavior intentionally differs; the project's own QUnit, E2E and FLP suites cover it.                                                                                            |
| Public framework behavior, not UI5 internals where avoidable | Keeps the tests valid across UI5 versions and true to the drop-in claim.                                                                                                               |
| No monkey-patching in the harness                            | The project rejects global monkey-patching for runtime behavior; the tests follow the same rule.                                                                                       |
| Runs in the existing `test:qunit` lane                       | The proposal planned a dedicated CI lane. Registering `upstream-parity/Current` in `testsuite.qunit.ts` was enough; CI runs `npm run verify:openui5-router-vendor` as a separate step. |

This is a conformance-style layer. It replaces none of the existing tests.

## Provenance

Raw files carry no local headers, import rewrites or formatting changes. Each port starts with a header like this:

```ts
/**
 * Ported from vendored OpenUI5 test source
 * Source repo: UI5/openui5
 * Source path: <original path>
 * Source tag: 1.144.0
 * Source commit: <sha>
 * Imported: 2026-03-18
 * Local adaptations:
 * - Replaced original upstream test bootstrap with local adapter harness
 * - Scoped execution to native-parity mode (no guards registered)
 */
```

`vendor-manifest.json` records, per case: the raw file path, the port path, the source path, tag and SHA, the import date, an adaptation summary, and a status: `ported` (the full upstream test) or `ported-subset` (selected cases from a larger file).

## Test taxonomy

Upstream tests fall into three tiers.

**Tier 1, import first**: high-value public-contract tests with low maintenance cost.

- API surface
- `match()`, `getRouteInfoByHash()`, `getRoute()`, `getURL()`
- basic `navTo()` and `navTo(..., true)` (replace)
- hash-change direction
- `routeMatched` / `patternMatched` / `bypassed` payloads

**Tier 2, import with adaptation**: useful but harness-sensitive.

- tests coupled to upstream fixtures
- tests that assume specific async timing helpers
- tests that expect UI5's internal module layout or the original test bootstrap

**Tier 3, exclude**:

- tests that assert private UI5 implementation details
- tests that conflict with documented guard-router extensions
- tests that local suites already cover better
- tests whose framework-internal harness dependencies outweigh their value

## Risks

| Risk                     | Mitigation                                                                                     |
| ------------------------ | ---------------------------------------------------------------------------------------------- |
| Importing too many tests | Start with Tier 1.                                                                             |
| False confidence         | Docs always separate native parity from guard behavior; "upstream parity" never covers guards. |
| Harness drift            | Raw files stay untouched, ports stay thin, adaptations are reviewed explicitly.                |
| UI5 version drift        | The suite is pinned to one OpenUI5 tag and SHA and updated deliberately.                       |

## Resolved questions

- **Version**: the ports are pinned to OpenUI5 1.144.0, the development version. They run on both QUnit lanes, 1.144.0 (`npm run test:qunit`) and 1.120.0 (`npm run test:qunit:compat:120`), because both run every page of `testsuite.qunit.ts`.
- **Scope**: `sap.m.routing.Router` only. `sap.ui.core.routing.Router` is out of scope.
- **Sync script**: supports `--tag` and `--sha`. `--sha` alone is for ad-hoc fetching; `--write-manifest` requires `--tag`.
- **Excluded tests**: not tracked in the manifest. The taxonomy above and the local README give the reasons.
