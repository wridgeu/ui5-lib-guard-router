# Vendored OpenUI5 Router Parity Suite

> **Status**: Implemented. The initial vendored parity lane shipped in PR #33.
> See [docs/reference/upstream-parity.md](../reference/upstream-parity.md) and the [local README](../../packages/lib/test/qunit/upstream-parity/README.md) for the shipped layout and maintenance process.

**Goal:** Add a vendored upstream parity test lane that ports selected public OpenUI5 `sap.m.routing.Router` tests into this repository, runs them against both the native router and `ui5.guard.router.Router`, and proves drop-in compatibility whenever no guards are installed.

**Why now:** The library already claims drop-in compatibility with `sap.m.routing.Router`, and it already maintains a local differential suite in `packages/lib/test/qunit/NativeRouterCompat.qunit.ts`. A vendored parity lane pins compatibility against upstream framework behavior and makes regressions easier to detect when the library evolves or when the UI5 baseline changes.

**Architecture:** Keep two test layers and two source forms:

- `NativeRouterCompat.qunit.ts` remains the fast local parity smoke suite owned entirely by this repo.
- A new vendored upstream-parity lane keeps **byte-for-byte upstream snapshots** in a `vendor/` subtree, then runs **local executable ports/wrappers** against a shared harness in the "no guards registered" contract mode.

---

## Problem Statement

The library extends `sap.m.routing.Router` and advertises itself as a drop-in replacement, but most compatibility guarantees are currently enforced by tests written from this repository's point of view. That is valuable, but it does not answer a stricter question:

> Do we still behave like the native router when measured against the framework's own public-router expectations?

Today, the answer is only partially covered.

- The local compatibility suite in `packages/lib/test/qunit/NativeRouterCompat.qunit.ts` already compares the native router and the guard router across several core behaviors.
- That suite works as a fast smoke layer, but it is still curated entirely by this project.
- The project does not yet keep a pinned, provenance-tracked set of upstream OpenUI5 router tests that can act as an additional contract suite.

This matters for four reasons:

1. **Compatibility confidence**
    - The library depends on subclassing and overriding router behavior.
    - A vendored parity lane verifies that inherited router behavior remains aligned with OpenUI5 when guards are inactive.

2. **Maintainability**
    - When internal refactors happen, it is easy to accidentally preserve the library's own tests while drifting from upstream expectations.
    - Vendored tests create a second, external reference point.

3. **Release discipline**
    - When the UI5 baseline changes, a pinned upstream parity lane highlights meaningful behavioral deltas.
    - This matters more for a router library that claims drop-in compatibility.

4. **Documentation honesty**
    - The project should distinguish clearly between:
        - native-router compatibility when no guards are active
        - extended guard behavior, which intentionally diverges
    - A vendored parity lane helps support that distinction with evidence.

---

## Decision Summary

Implement a new **vendored OpenUI5 router parity suite** with the following rules:

- Use **selected, pinned, public OpenUI5 router tests** only.
- Vendor them into the repository; do **not** fetch tests dynamically in CI.
- Keep the vendored source as **raw upstream copies**.
- Put any executable adaptations into a **separate local ports/wrappers layer** driven by a shared harness.
- Run them only under the **native-parity contract**: no guards registered, no guard-specific expectations.
- Keep all guard semantics in the project's own QUnit/E2E/FLP suites.

This is a **conformance-style test layer**, not a replacement for existing tests.

---

## Design Principles

### 1. Single Contract, Not Conflicting Contracts

The vendored suite must verify only the native contract we actually inherit and claim:

- public router API
- route matching
- URL generation
- `navTo` behavior
- `replace` behavior
- public routing events
- initialize / stop / destroy lifecycle behavior where publicly observable

It must **not** be used to judge behavior that is intentionally extended by this library:

- guard registration APIs
- settlement APIs
- leave guards
- redirect/block semantics when guards are active
- FLP dirty-state behavior

### 2. UI5-Standard and SAP-Standard Respect

The suite should align with SAP/UI5 norms:

- test against public framework behavior, not private UI5 internals when avoidable
- preserve `sap.m.routing.Router` subclass/drop-in semantics
- avoid global monkey-patching strategies that the project already rejects for runtime behavior
- keep the router's public API ergonomic for both TypeScript and JavaScript consumers

### 3. Maintainability First

The project should not copy a large body of upstream tests blindly.

Instead:

- import a **curated** subset
- track provenance precisely
- centralize local adaptations in harness helpers and wrapper files
- keep raw vendored files as exact upstream snapshots

### 4. Honest Documentation

The suite should strengthen a narrower, more accurate claim:

> `ui5.guard.router.Router` matches native `sap.m.routing.Router` behavior for inherited routing behavior when guards are not active.

That is the contract the vendored suite should support.

---

## Scope

### In Scope

- vendoring selected public OpenUI5 router tests
- adding a dedicated upstream parity folder and manifest
- building a reusable native-vs-guard harness
- adding a dedicated CI/test lane
- documenting provenance, limitations, and maintenance process
- tightening public docs around what parity means

### Out of Scope

- importing SAP-internal or unpublished framework CI tests
- dynamically downloading tests at runtime or in CI
- using vendored tests to verify guard behavior
- changing the public guard API as part of this feature
- replacing the existing local compatibility suite

---

## File Map

| Action | File                                                                   | Responsibility                                                                                                     |
| ------ | ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| Create | `packages/lib/test/qunit/upstream-parity/README.md`                    | Local overview of the vendored parity suite, provenance rules, scripts, and how to update it                       |
| Create | `packages/lib/test/qunit/upstream-parity/manifest.json`                | Machine-readable index of vendored raw files, executable ports, source paths, pinned tag/SHA, and adaptation notes |
| Create | `packages/lib/test/qunit/upstream-parity/adapters/routerFactories.ts`  | Factory helpers for native router vs guard router construction                                                     |
| Create | `packages/lib/test/qunit/upstream-parity/adapters/fixtures.ts`         | Shared route configs, test fixtures, hash reset helpers, and reusable setup                                        |
| Create | `packages/lib/test/qunit/upstream-parity/adapters/assertions.ts`       | Parity assertions and shared event/hash comparison helpers                                                         |
| Create | `packages/lib/test/qunit/upstream-parity/vendor/openui5/<tag>/raw/...` | Byte-for-byte vendored upstream router test files                                                                  |
| Create | `packages/lib/test/qunit/upstream-parity/ports/openui5/<tag>/...`      | Local executable ports/wrappers that run vendored cases through the adapter harness                                |
| Modify | `packages/lib/test/qunit/testsuite.qunit.ts`                           | Register the new vendored parity modules in the QUnit suite                                                        |
| Modify | `packages/lib/test/wdio-qunit.conf.ts`                                 | Register `UpstreamParity` in the main QUnit WDIO config paths                                                      |
| Create | `scripts/vendor-openui5-router-tests.mjs`                              | Maintainer sync script that fetches pinned upstream router test files into the raw vendor tree                     |
| Create | `scripts/verify-openui5-router-vendor.mjs`                             | Verifies manifest integrity, provenance, and raw-vs-ported mapping                                                 |
| Modify | `README.md`                                                            | Explain the new parity lane and the difference between native compatibility and guard behavior                     |
| Modify | `packages/lib/README.md`                                               | Clarify what "drop-in replacement" means and how parity is validated                                               |
| Modify | `docs/README.md`                                                       | Add the new proposal to the documentation map                                                                      |
| Modify | `docs/features/README.md`                                              | Add an entry for this implementation plan                                                                          |
| Create | `docs/reference/upstream-parity.md`                                    | Long-form reference for scope, provenance, exclusions, maintenance, and update process                             |
| Modify | `.github/workflows/ci.yml` or equivalent reusable workflow             | Add a dedicated upstream parity lane with clear reporting                                                          |

---

## Directory Layout

```text
packages/lib/test/qunit/
  UpstreamParity.qunit.ts          # testsuite entrypoint (registered in testsuite.qunit.ts)
  upstream-parity/
    Current.qunit.ts               # imports all active versioned ports
    README.md
    manifest.json
    adapters/
      assertions.ts
      fixtures.ts
      routerFactories.ts
    ports/
      openui5/
        1.144.0/
          sap.m.routing.Router/
            Router.qunit.ts        # executable port of selected upstream cases
    vendor/
      openui5/
        1.144.0/
          raw/
            src/sap.m/test/sap/m/qunit/routing/async/
              Router.qunit.js      # byte-for-byte upstream snapshot
```

Constraints:

- exact upstream snapshots stay under `vendor/openui5/<tag>/raw/` preserving the original source path
- executable local ports live under `ports/openui5/<tag>/` grouped by upstream module
- local harness code stays in `adapters/`, outside both vendor and ports
- provenance is tracked centrally in `manifest.json`

---

## Provenance and Vendoring Rules

Raw vendored files should remain **byte-for-byte upstream copies**. That means:

- no local comment headers inside raw files
- no local import rewrites inside raw files
- no formatting or lint-driven modifications inside raw files

Instead, provenance should live in the manifest and in the corresponding local port/wrapper file.

Every local executable port should include a header like this:

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

The manifest should record, per case:

- raw vendored file path
- local port/wrapper file path
- source file path
- source tag
- source SHA
- imported date
- adaptation summary
- status:
    - `ported` -- full upstream test ported and executable
    - `ported-subset` -- selected test cases ported from a larger upstream file

This keeps the suite auditable and maintainable.

---

## Test Taxonomy

The vendored suite should classify upstream tests into three buckets.

### Tier 1: Safe to Import First

These are high-value, public-contract tests with low maintenance cost.

- API surface parity
- `match()` parity
- `getRouteInfoByHash()` parity
- `getRoute()` parity
- `getURL()` parity
- basic `navTo()` parity
- `navTo(..., true)` / replace parity
- hash-change direction parity
- routeMatched / patternMatched / bypassed public payloads

### Tier 2: Import with Adaptation

These are useful but more harness-sensitive.

- tests coupled to upstream fixtures
- tests assuming specific async timing helpers
- tests expecting UI5-internal module layout or original test bootstraps

### Tier 3: Exclude Intentionally

These should not be imported.

- tests that assert private UI5 implementation details
- tests that conflict with documented guard-router extensions
- tests whose value is already covered better by local suites
- tests with unstable or framework-internal harness dependencies disproportionate to their value

---

## Contract Definition

The vendored parity lane verifies only the following contract:

### Native-Parity Contract

When no guards are registered:

- `ui5.guard.router.Router` remains an instance of `sap.m.routing.Router`
- inherited public routing methods behave like the native router
- route matching and URL generation match native behavior
- routing events expose equivalent public parameters
- lifecycle transitions such as initialize/stop/reinitialize remain aligned where publicly observable
- `navTo()` and replace behavior match native behavior unless a documented extension explicitly says otherwise

### Explicitly Separate Extended Contract

When guards are registered, the library follows its own extended contract, validated by local tests:

- guard APIs and guard context
- block/redirect behavior
- leave guard behavior
- navigation settlements and `navigationSettled()`
- FLP integration and dirty-state provider behavior

The documentation must always distinguish those two contracts.

---

## Implementation

Shipped in PR #33. See the [File Map](#file-map) above for the full list of created and modified files.

---

## Risks

### Risk 1: Over-importing Upstream Tests

Importing too many upstream tests too early will raise maintenance cost and slow the suite.

**Mitigation:** Start with Tier 1 only.

### Risk 2: False Confidence

If docs say "upstream parity" without scoping it, readers may assume the vendored suite proves guard behavior too.

**Mitigation:** Separate native parity and guard behavior everywhere in docs.

### Risk 3: Harness Drift

Local adapters and ports can accidentally change the meaning of imported tests.

**Mitigation:** Keep raw files untouched, keep ports thin, and review adaptations explicitly.

### Risk 4: UI5 Version Drift

Upstream router tests may evolve in ways that are not worth porting immediately.

**Mitigation:** Pin the suite to a specific OpenUI5 tag/SHA and update deliberately.

---

## Resolved Questions

- **Vendored lane runs only on the shipped UI5 baseline.** The compatibility lane (1.120) runs the library's own QUnit suite, not vendored upstream tests.
- **Initial import targets `sap.m.routing.Router` only.** `sap.ui.core.routing.Router` is not in scope.
- **The sync script supports both `--tag` and `--sha`.** `--sha` alone is for ad-hoc fetching; `--write-manifest` requires `--tag`.
- **Excluded tests are not tracked in the manifest.** The tier taxonomy in this doc and the local README document exclusion rationale instead.
