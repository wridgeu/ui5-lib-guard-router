# Vendored OpenUI5 Router Parity Suite - Implementation Plan

> Status: the initial vendored parity lane is implemented. The remaining checklist in this document tracks future expansion and maintenance work.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a vendored upstream parity test lane that ports selected public OpenUI5 `sap.m.routing.Router` tests into this repository, runs them against both the native router and `ui5.guard.router.Router`, and proves drop-in compatibility whenever no guards are installed.

**Why now:** The library already claims drop-in compatibility with `sap.m.routing.Router`, and it already maintains a local differential suite in `packages/lib/test/qunit/NativeRouterCompat.qunit.ts`. A vendored parity lane strengthens that claim, gives the project a pinned compatibility baseline against upstream framework behavior, and makes regressions easier to detect when the library evolves or when the UI5 baseline changes.

**Architecture:** Keep two test layers and two source forms:

- `NativeRouterCompat.qunit.ts` remains the fast local parity smoke suite owned entirely by this repo.
- A new vendored upstream-parity lane keeps **byte-for-byte upstream snapshots** in a `vendor/` subtree, then runs **local executable ports/wrappers** against a shared harness in the "no guards registered" contract mode.

**Tech Stack:** TypeScript, UI5 (`sap.m.routing.Router`), QUnit, OpenUI5 vendored test fixtures, npm workspaces, GitHub Actions

---

## Problem Statement

The library extends `sap.m.routing.Router` and advertises itself as a drop-in replacement, but most compatibility guarantees are currently enforced by tests written from this repository's point of view. That is valuable, but it does not fully answer a stricter question:

> Do we still behave like the native router when measured against the framework's own public-router expectations?

Today, the answer is only partially covered.

- The local compatibility suite in `packages/lib/test/qunit/NativeRouterCompat.qunit.ts` already compares the native router and the guard router across several core behaviors.
- That suite is excellent as a fast smoke layer, but it is still curated entirely by this project.
- The project does not yet keep a pinned, provenance-tracked set of upstream OpenUI5 router tests that can act as an additional contract suite.

This matters for four reasons:

1. **Compatibility confidence**
    - The library depends on subclassing and overriding router behavior.
    - A vendored parity lane provides stronger evidence that inherited router behavior remains aligned with OpenUI5 when guards are inactive.

2. **Maintainability**
    - When internal refactors happen, it is easy to accidentally preserve the library's own tests while drifting from upstream expectations.
    - Vendored tests create a second, external reference point.

3. **Release discipline**
    - When the UI5 baseline changes, a pinned upstream parity lane highlights meaningful behavioral deltas.
    - That is especially valuable for a router library whose core promise includes native ergonomics.

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
| Modify | `packages/lib/package.json`                                            | Add a dedicated npm script such as `test:qunit:upstream-parity`                                                    |
| Create | `scripts/vendor-openui5-router-tests.mjs`                              | Maintainer sync script that fetches pinned upstream router test files into the raw vendor tree                     |
| Create | `scripts/verify-openui5-router-vendor.mjs`                             | Verifies manifest integrity, provenance, and raw-vs-ported mapping                                                 |
| Modify | `README.md`                                                            | Explain the new parity lane and the difference between native compatibility and guard behavior                     |
| Modify | `packages/lib/README.md`                                               | Clarify what "drop-in replacement" means and how parity is validated                                               |
| Modify | `docs/README.md`                                                       | Add the new proposal to the documentation map                                                                      |
| Modify | `docs/features/README.md`                                              | Add an entry for this implementation plan                                                                          |
| Create | `docs/reference/upstream-parity.md`                                    | Long-form reference for scope, provenance, exclusions, maintenance, and update process                             |
| Modify | `.github/workflows/ci.yml` or equivalent reusable workflow             | Add a dedicated upstream parity lane with clear reporting                                                          |

---

## Proposed Directory Layout

```text
packages/lib/test/qunit/upstream-parity/
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
          api-parity.qunit.ts
          route-matching.qunit.ts
          navto.qunit.ts
          events.qunit.ts
          replace.qunit.ts
          hash-direction.qunit.ts
  vendor/
    openui5/
      1.144.0/
        raw/
          sap.m.routing.Router/
            Router.qunit.js
            HashChanger.qunit.js
```

The exact file split can evolve, but the important constraints are:

- exact upstream snapshots stay under `vendor/openui5/<tag>/raw/`
- executable local ports stay outside the vendored subtree under `ports/`
- local harness code stays outside both the raw vendor and the ports tree where practical
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
 * Source repo: SAP/openui5
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
- status (`active`, `adapted`, `excluded`, `replaced`)

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

## Implementation Plan

## Task 1: Set Up the Upstream-Parity Test Skeleton

**Files:**

- Create: `packages/lib/test/qunit/upstream-parity/README.md`
- Create: `packages/lib/test/qunit/upstream-parity/manifest.json`
- Create: `packages/lib/test/qunit/upstream-parity/adapters/routerFactories.ts`
- Create: `packages/lib/test/qunit/upstream-parity/adapters/fixtures.ts`
- Create: `packages/lib/test/qunit/upstream-parity/adapters/assertions.ts`
- Create: `packages/lib/test/qunit/upstream-parity/ports/openui5/<tag>/...`
- Create: `packages/lib/test/qunit/upstream-parity/vendor/openui5/<tag>/raw/...`

- [ ] **Step 1: Create the folder structure**

Create the `upstream-parity` root, the `adapters` directory, the versioned raw vendor subtree, and the separate `ports/` subtree.

- [ ] **Step 2: Add a local README**

Document:

- purpose of the suite
- difference from `NativeRouterCompat.qunit.ts`
- vendoring rules
- provenance requirements
- sync/update policy

- [ ] **Step 3: Add `manifest.json`**

Define a stable schema for:

- suite version
- upstream OpenUI5 tag/SHA
- raw vendored files
- local ports/wrappers
- excluded files
- adaptation notes

- [ ] **Step 4: Create adapter helpers**

The adapter layer should expose:

- native router factory
- guard router factory
- shared route fixture factory
- hash reset/init helpers
- shared assertion helpers for hash, events, and route metadata

The initial goal is not sophistication - it is consistency.

---

## Task 2: Import the First Curated OpenUI5 Router Tests

**Files:**

- Create: raw vendored test files under `packages/lib/test/qunit/upstream-parity/vendor/openui5/<tag>/raw/`
- Create: executable ports under `packages/lib/test/qunit/upstream-parity/ports/openui5/<tag>/`

- [ ] **Step 1: Identify public, stable candidate tests from OpenUI5**

Start with Tier 1 cases only.

- API parity
- route matching
- URL generation
- `navTo` and replace behavior
- event payload parity
- hash direction behavior

- [ ] **Step 2: Vendor the upstream files as raw snapshots**

Each raw file should preserve the upstream contents exactly.

- [ ] **Step 3: Create local executable ports/wrappers**

Do not rewrite the behavioral core of the tests more than necessary; move environment differences into the local harness and keep each port linked clearly to its raw source.

- [ ] **Step 4: Register raw files and ports in the manifest**

Record exact source path, source tag/SHA, raw file path, local port path, and adaptation summary.

---

## Task 3: Wire the Vendored Suite into QUnit and npm Scripts

**Files:**

- Modify: `packages/lib/test/qunit/testsuite.qunit.ts`
- Modify: `packages/lib/package.json`
- Create: `scripts/vendor-openui5-router-tests.mjs`
- Create: `scripts/verify-openui5-router-vendor.mjs`

- [ ] **Step 1: Register the vendored parity modules in the QUnit testsuite**

Keep the lane logically separate from the project's own QUnit tests.

- [ ] **Step 2: Add a dedicated test script**

Add something like:

```json
"test:qunit:upstream-parity": "wdio run test/wdio-qunit.conf.ts --suite upstream-parity"
```

Adapt the exact command to the existing QUnit lane setup.

- [ ] **Step 3: Keep the execution model simple**

Prefer a dedicated suite or test bundle rather than dynamically filtering many unrelated files.

- [ ] **Step 4: Add a maintainer sync script**

Add a script such as:

```json
"vendor:openui5-router-tests": "node ./scripts/vendor-openui5-router-tests.mjs"
```

Expected usage:

```bash
npm run vendor:openui5-router-tests -- --tag 1.144.0
```

The script should:

- require an explicit `--tag` or `--sha`
- fetch only the configured upstream router test files
- write them into `vendor/openui5/<tag>/raw/`
- update `manifest.json`
- support `--dry-run`

- [ ] **Step 5: Add a verification script**

Add a script such as:

```json
"verify:openui5-router-vendor": "node ./scripts/verify-openui5-router-vendor.mjs"
```

It should verify:

- manifest consistency
- expected raw file presence
- raw/port mapping completeness
- provenance metadata completeness

---

## Task 4: Integrate with CI

**Files:**

- Modify: CI workflow files

- [ ] **Step 1: Add a separate upstream parity lane**

The CI job name should clearly communicate its purpose, e.g. `qunit-upstream-parity`.

- [ ] **Step 2: Keep reporting isolated**

Do not mix vendored parity failures with guard-behavior failures in job naming or summaries.

- [ ] **Step 3: Run on the shipped UI5 baseline first**

Only add compatibility-lane execution later if the maintenance cost is justified.

---

## Task 5: Tighten Documentation End-to-End

**Files:**

- Modify: `README.md`
- Modify: `packages/lib/README.md`
- Modify: `docs/README.md`
- Modify: `docs/features/README.md`
- Create: `docs/reference/upstream-parity.md`

- [ ] **Step 1: Add a dedicated reference doc**

`docs/reference/upstream-parity.md` should explain:

- suite purpose
- contract scope
- what is imported vs excluded
- provenance rules
- how to update the suite when the UI5 baseline changes

- [ ] **Step 2: Clarify README wording**

The public docs should say:

- native compatibility is validated by both local differential tests and a vendored upstream parity lane
- that claim applies to inherited router behavior when guards are inactive
- guard behavior is validated by separate suites

- [ ] **Step 3: Keep wording honest and maintainable**

Avoid suggesting that upstream parity covers the guard extensions.

---

## Task 6: Preserve TypeScript, JavaScript, and Consumer Ergonomics

**Files:**

- Modify as needed: adapter helpers and docs only

- [ ] **Step 1: Keep the feature implementation test-only**

This parity lane should not require changes to the public runtime API.

- [ ] **Step 2: Type adapter helpers cleanly**

The vendored suite should be easy to maintain for TypeScript contributors and readable for JavaScript-oriented UI5 contributors.

- [ ] **Step 3: Keep public consumer docs unaffected unless wording needs clarification**

The feature is an internal quality/verification improvement, not a new consumer-facing API.

---

## Task 7: Define a Sync and Review Process

**Files:**

- Create/Modify: `packages/lib/test/qunit/upstream-parity/README.md`
- Create/Modify: `docs/reference/upstream-parity.md`

- [ ] **Step 1: Define when the vendored suite is updated**

Recommended triggers:

- UI5 baseline bump
- router compatibility incident
- major router refactor

- [ ] **Step 2: Define who reviews vendored changes**

Vendored parity updates should receive focused review because they affect contract evidence, not just implementation.

- [ ] **Step 3: Prefer manual or assisted sync, not CI fetching**

If a helper script is added later, it should support maintainers locally but should not fetch remote code during CI execution.

- [ ] **Step 4: Define the raw-vendor rule explicitly**

Document that `vendor/openui5/<tag>/raw/` contains exact upstream snapshots, while local executable ports live separately under `ports/`.

---

## Documentation and Quality Notes

### Maintainability

- Keep raw vendored tests as exact upstream copies.
- Push local logic into adapters and ports, not into raw vendored files.
- Track every adaptation explicitly.
- Avoid importing more tests than the team is willing to maintain.

### JavaScript and TypeScript Balance

- The vendored tests can stay in TypeScript to match the repo and existing test tooling.
- Headers and helper names should stay readable for JS-first contributors.
- Avoid over-engineered abstractions in the adapter harness.

### UI5 Framework Standards

- Assert against public router behavior and public event payloads first.
- Do not build the parity suite on fragile private UI5 internals.
- Respect the router's standard lifecycle and `navTo` semantics.
- Keep the runtime router implementation itself unchanged unless parity findings justify a bug fix.

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

## Open Questions

- Should the vendored lane run only on the shipped UI5 baseline, or also on the compatibility baseline?
- Should the initial import target `sap.ui.core.routing.Router` behavior too, or stay strictly on `sap.m.routing.Router` first?
- Should the sync script support only `--tag`, or also exact commit SHAs and file allowlists?
- Should excluded upstream tests also be recorded in the manifest for transparency, or only in the long-form docs?

---

## Recommended Rollout

### Milestone 1: Skeleton and Documentation

- folder structure
- manifest + verifier
- local README
- reference doc
- npm script placeholder

### Milestone 2: First Curated Import

- 5-10 Tier 1 test files vendored
- adapter harness in place
- passing local execution

### Milestone 3: CI Integration

- dedicated lane
- clear reporting
- documentation updated in root/package README

### Milestone 4: Maintenance Process

- provenance review rules
- update policy documented
- optional local sync helper considered

---

## Acceptance Criteria

- A vendored upstream parity folder exists with provenance-tracked files.
- The suite runs as its own dedicated lane.
- Imported tests cover at least one meaningful Tier 1 batch.
- Public docs clearly distinguish native-router parity from guard-specific behavior.
- CI reports vendored parity failures separately from feature regressions.
- The maintenance/update process is documented well enough that another contributor can extend the suite without reverse-engineering intent.

---

## Suggested First Commit Breakdown

1. `test(qunit): scaffold vendored upstream router parity suite`
2. `test(qunit): add OpenUI5 vendor sync and verification scripts`
3. `test(qunit): import first OpenUI5 router parity batch`
4. `docs: document upstream parity contract and maintenance process`
5. `ci: add vendored upstream parity lane`

This keeps provenance, implementation, and CI reviewable in manageable slices.
