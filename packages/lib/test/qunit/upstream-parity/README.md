# Vendored OpenUI5 Router Parity Suite

This folder runs OpenUI5's own router tests, pinned to one upstream tag, against the guard router with no guards registered.
It checks inherited `sap.m.routing.Router` behavior. It does **not** check guard behavior.
It complements the local differential tests in `../parity/`.

## Structure

```text
upstream-parity/
  Current.qunit.ts       test page entry; imports the current port set
  adapters/              shared harness helpers
  vendor-manifest.json   upstream provenance and raw-to-port mapping
  ports/                 executable local ports
  vendor/                raw upstream snapshots
```

Current mapping (one raw file to one port):

- raw: `vendor/openui5/1.144.0/raw/src/sap.m/test/sap/m/qunit/routing/async/Router.qunit.js`
- port: `ports/openui5/1.144.0/sap.m.routing.Router/Router.qunit.ts`

Vendor only raw files that a port executes. Do not keep raw support modules unless they are worth reviewing or porting.

## Rules

- Files under `vendor/openui5/<tag>/raw/` stay byte-for-byte identical to upstream. Do not format them, rewrite imports or add comments.
- Local logic goes in `ports/` and `adapters/` only. Keep ports thin.
- Raw files are refreshed by the script. Ports are maintained by hand.

`vendor-manifest.json` is the source of truth for the upstream repo, tag and commit SHA, the raw file paths and checksums, the port paths and adaptation notes. `npm run verify:openui5-router-vendor` checks its structure, the raw file checksums and the `Current.qunit.ts` wiring.

## Scripts

- `npm run test:qunit`: runs the QUnit suite, including this one
- `npm run vendor:openui5-router-tests -- --tag <version> [--write-manifest]`: fetches raw files; with `--write-manifest`, also updates the manifest
- `npm run verify:openui5-router-vendor`: checks the manifest and raw files

To refresh the current version, re-fetch the pinned raw files and keep the manifest, `Current.qunit.ts` and `ports/` on the same tag.

## Bump the upstream version

Example: `1.144.0` to `1.145.0`.

1. Start from a green branch:

    ```bash
    npm run verify:openui5-router-vendor
    npm run test:qunit
    ```

2. Fetch the new raw snapshot. This writes `vendor/openui5/1.145.0/raw/` and leaves the manifest unchanged:

    ```bash
    npm run vendor:openui5-router-tests -- --tag 1.145.0
    ```

3. Diff the old and new raw trees. Decide which upstream changes affect the ports and whether a new port is needed.

4. Copy the ports to `ports/openui5/1.145.0/`, update them, and point `Current.qunit.ts` at the new set.

5. Update the manifest (tag, commit SHA, raw paths, checksums):

    ```bash
    npm run vendor:openui5-router-tests -- --tag 1.145.0 --write-manifest
    ```

    The script refuses if any `portFilePath` still points at another version.

6. Run `npm run verify:openui5-router-vendor` and `npm run test:qunit` again.
