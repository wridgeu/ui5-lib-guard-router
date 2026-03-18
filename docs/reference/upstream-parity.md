# Upstream Parity

## Purpose

This repository keeps two complementary compatibility layers for the core router:

- `packages/lib/test/qunit/NativeRouterCompat.qunit.ts` - fast local differential tests authored in this repo
- `packages/lib/test/qunit/upstream-parity/` - a vendored OpenUI5 parity lane with pinned upstream source snapshots and local executable ports

The vendored lane exists to answer a specific question:

> When no guards are registered, does `ui5.guard.router.Router` still behave like the native `sap.m.routing.Router` for inherited routing behavior?

It is a conformance-style test layer, not a replacement for the library's own feature tests.

## Contract

The upstream parity lane verifies only the native inherited contract:

- public router API surface
- route matching and URL generation
- `navTo()` and replace behavior
- public routing events and parameters
- lifecycle behavior such as initialize/stop/reinitialize where publicly observable

It does not verify the library's extended behavior:

- guard APIs
- navigation settlements
- leave guards
- block/redirect semantics with active guards
- FLP integration or dirty-state handling

Those remain covered by the local QUnit, E2E, and FLP suites.

## Layout

```text
packages/lib/test/qunit/upstream-parity/
  README.md
  manifest.json
  adapters/
  ports/
  vendor/
```

- `vendor/openui5/<tag>/raw/` keeps exact upstream snapshots
- `ports/openui5/<tag>/` contains local executable ports/wrappers
- `adapters/` contains shared local harness helpers
- `manifest.json` records provenance and raw-to-port mapping

## Vendoring Rules

- Raw vendored files stay byte-for-byte identical to upstream.
- Local changes belong in `ports/` and `adapters/`, not in `vendor/`.
- Every executable port references its upstream source path, tag, and commit SHA.
- CI never fetches upstream tests dynamically; vendoring happens through maintainer scripts only.

## Scripts

- `npm run test:qunit:upstream-parity` - run the vendored parity lane
- `npm run vendor:openui5-router-tests -- --tag <version> --write-manifest` - fetch pinned upstream router test files into the raw vendor tree and refresh manifest provenance
- `npm run verify:openui5-router-vendor` - verify manifest integrity and raw/port mapping

## Maintenance

Update the vendored lane when one of these happens:

- the shipped UI5 baseline changes
- a router compatibility regression is found
- a major router refactor changes inherited routing behavior

Recommended process:

1. fetch a new raw snapshot with the vendoring script
2. review the upstream diff
3. update or add local executable ports only where valuable
4. for a version bump, migrate the versioned port paths before writing the new manifest version
5. run the dedicated upstream parity lane

## Current Scope

The initial implementation vendors selected files from the OpenUI5 async `sap.m.routing.Router` QUnit suite and ports a small first batch of parity cases through the local harness.

This is intentionally incremental: start with high-value router cases, keep provenance explicit, and expand only when the maintenance cost is justified.
