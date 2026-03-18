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
- local executable port paths
- adaptation notes

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
