# Vendored OpenUI5 Router Parity Suite

This folder contains the repository's vendored OpenUI5 router parity lane.

## Purpose

The parity lane supplements `NativeRouterCompat.qunit.ts` with a pinned upstream reference set.
It verifies inherited `sap.m.routing.Router` behavior when no guards are registered.

It does **not** verify guard-specific behavior.

## Structure

```text
upstream-parity/
  adapters/  shared local harness helpers
  ports/     executable local ports/wrappers
  vendor/    raw upstream snapshots
  manifest.json
```

## Raw Vendor Rule

- Files under `vendor/openui5/<tag>/raw/` must stay byte-for-byte identical to upstream.
- Do not format, rewrite imports, or add local comments there.
- Put local execution logic in `ports/` and `adapters/` only.

## Provenance

`manifest.json` is the source of truth for:

- upstream repo, tag, and commit SHA
- tracked source files
- raw snapshot paths
- raw snapshot checksums
- local executable port paths
- adaptation notes

## Mapping Model

The parity lane does **not** treat every raw upstream file the same way.

- executable upstream test entrypoints should map clearly to their own executable port files
- upstream support modules may remain raw-only if they are not independently runnable test entrypoints

For the current OpenUI5 async router import set:

- `Router.qunit.js` is the executable upstream test entrypoint
    - it maps to `ports/openui5/1.144.0/sap.m.routing.Router/Router.qunit.ts`
- `helpers.js` and `commonIntegrationTests.js` are support modules
    - they stay vendored as raw provenance files
    - they are linked in `manifest.json` as support files used by the `Router.qunit.ts` port

So the rule is:

- one executable upstream test module -> one executable local port
- support modules -> raw snapshots with explicit manifest linkage, not fake standalone ports

That keeps the adoption traceable without inventing meaningless wrapper files for modules that are not standalone tests.

## Scripts

- `npm run test:qunit:upstream-parity`
- `npm run vendor:openui5-router-tests -- --tag <version> --write-manifest`
- `npm run verify:openui5-router-vendor`

## Update Process

1. Fetch or refresh the raw upstream snapshots with the vendoring script.
2. Review upstream diffs before changing any ports.
3. Keep local executable ports thin and traceable.
4. For a version bump, migrate the versioned `portFilePath` entries before writing the new manifest version.
5. Run the verification and parity test scripts.

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
- decide whether existing ports still represent the right subset or whether new ports should be added

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

## What Is Manual vs Automatic?

Automatic or assisted:

- fetching raw upstream files
- updating raw file checksums
- updating raw file paths in the manifest
- verifying raw-file integrity and current entrypoint wiring

Manual:

- deciding which upstream files are worth porting
- updating `ports/` to match the intended upstream scenarios
- deciding whether an upstream change affects the public parity contract we care about
- updating `Current.qunit.ts` when the active version changes

That split is deliberate. The raw vendor tree should be mechanical; the executable ports require engineering judgment.
