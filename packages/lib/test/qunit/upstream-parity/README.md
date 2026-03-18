# Vendored OpenUI5 Router Parity Suite

This folder contains the repository's vendored OpenUI5 router parity lane.

## Purpose

The parity lane supplements `NativeRouterCompat.qunit.ts` with a pinned upstream reference set.
It verifies inherited `sap.m.routing.Router` behavior when no guards are registered.

It does **not** verify guard-specific behavior.

## Structure

```text
upstream-parity/
  adapters/              shared local harness helpers
  manifest.json          pinned upstream provenance and raw-to-port mapping
  manifest.schema.json   JSON Schema for manifest.json
  ports/                 executable local ports/wrappers
  vendor/                raw upstream snapshots
```

## Raw Vendor Rule

- Files under `vendor/openui5/<tag>/raw/` must stay byte-for-byte identical to upstream.
- Do not format, rewrite imports, or add local comments there.
- Put local execution logic in `ports/` and `adapters/` only.

## Lean Mapping Model

The current parity lane is intentionally lean:

- only vendor upstream files that we actively keep as raw provenance and execute through a local port
- keep that mapping one-to-one wherever possible

For the current import set:

- `Router.qunit.js`
    - raw source: `vendor/openui5/1.144.0/raw/src/sap.m/test/sap/m/qunit/routing/async/Router.qunit.js`
    - local port: `ports/openui5/1.144.0/sap.m.routing.Router/Router.qunit.ts`

We do **not** keep additional raw support modules unless they are independently worth reviewing or porting later.

## Provenance

`manifest.json` is the source of truth for:

- upstream repo, tag, and commit SHA
- tracked raw source files
- raw snapshot paths
- raw snapshot checksums
- local executable port paths
- adaptation notes

`manifest.schema.json` validates the manifest structure before the verifier runs any repo-state checks.
The vendoring script also validates any rewritten manifest against the schema before saving it.

## Scripts

- `npm run test:qunit:upstream-parity`
- `npm run vendor:openui5-router-tests -- --tag <version> --write-manifest`
- `npm run verify:openui5-router-vendor`

## General Procedure

Use this folder in two modes:

- `refresh existing upstream version`
    - re-fetch the already pinned raw files for the current version
    - keep `manifest.json`, `Current.qunit.ts`, and the versioned `ports/` layout on the same upstream tag
- `bump to a new upstream version`
    - add a new raw snapshot under a new `vendor/openui5/<tag>/raw/` tree
    - migrate or add matching executable ports under `ports/openui5/<tag>/`
    - point `Current.qunit.ts` at the new current port set
    - update `manifest.json` only after the versioned ports are in place

The important rule is:

- raw files can be refreshed mechanically
- ports are maintained manually

The vendoring script helps with the first part. It does not safely regenerate the second part.

## How To Bump Upstream Parity

Example: bump from `1.144.0` to `1.145.0`.

1. Inspect the current state

```bash
npm run verify:openui5-router-vendor
npm run test:qunit:upstream-parity
```

Make sure the current branch is green before changing the upstream version.

2. Fetch the new raw upstream snapshot without touching the manifest yet

```bash
npm run vendor:openui5-router-tests -- --tag 1.145.0
```

This writes the raw files into `vendor/openui5/1.145.0/raw/`, but it does not switch the active version in `manifest.json`.

3. Review the upstream diff

- compare the old and new raw trees
- identify which upstream changes are relevant to the local executable ports
- decide whether the existing port still represents the right subset or whether a new port should be added

4. Migrate the executable ports

- copy or move the current port files into `ports/openui5/1.145.0/`
- update the new port files so they still reflect the intended upstream cases
- keep the ports thin; put shared helpers in `adapters/`
- update `Current.qunit.ts` to import the new current port set
- keep the raw-to-port mapping explicit in `manifest.json`

5. Update the manifest only after the ports are ready

```bash
npm run vendor:openui5-router-tests -- --tag 1.145.0 --write-manifest
```

This refreshes:

- `manifest.upstream.tag`
- `manifest.upstream.commitSha`
- raw file paths
- raw file checksums

The script intentionally refuses a version bump if `portFilePath` entries still point at the old version.

6. Verify and run the parity suite again

```bash
npm run verify:openui5-router-vendor
npm run test:qunit:upstream-parity
npm run test:qunit
```

If the current branch is meant to be release-ready, also run the broader validation lanes used for the library.

## What Is Automatic vs Manual?

Automatic or assisted:

- fetching raw upstream files
- updating raw file checksums
- updating raw file paths in the manifest
- validating the manifest against `manifest.schema.json`
- verifying raw-file integrity and current entrypoint wiring

Manual:

- deciding which upstream files are worth porting
- updating `ports/` to match the intended upstream scenarios
- deciding whether an upstream change affects the public parity contract we care about
- updating `Current.qunit.ts` when the active version changes

That split is deliberate. The raw vendor tree should be mechanical; the executable ports require engineering judgment.
