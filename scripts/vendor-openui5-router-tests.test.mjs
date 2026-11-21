import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { computeSha256, isValidUpstreamParityManifest } from "./upstream-parity-manifest-utils.mjs";

const UPSTREAM_TEXT = "QUnit.test('upstream', () => {});\n";
const SHA = "b".repeat(40);
const MANIFEST = "packages/lib/test/qunit/upstream-parity/vendor-manifest.json";
const SOURCE = "src/sap.m/test/sap/m/qunit/routing/async/Router.qunit.js";

/** A copy of the script in a temp repo whose manifest pins 1.144.0; fetch answers every URL with UPSTREAM_TEXT. */
function tempRepo() {
	const root = mkdtempSync(path.join(tmpdir(), "vendor-test-"));
	mkdirSync(path.join(root, "scripts"));
	for (const name of ["vendor-openui5-router-tests.mjs", "upstream-parity-manifest-utils.mjs"]) {
		copyFileSync(path.join(import.meta.dirname, name), path.join(root, "scripts", name));
	}
	writeFileSync(
		path.join(root, "fetch-stub.mjs"),
		`globalThis.fetch = async () => new Response(${JSON.stringify(UPSTREAM_TEXT)});\n`,
	);
	mkdirSync(path.dirname(path.join(root, MANIFEST)), { recursive: true });
	const manifest = {
		upstream: { repo: "UI5/openui5", tag: "1.144.0", commitSha: "a".repeat(40) },
		files: [
			{
				id: "Router",
				sourcePath: SOURCE,
				rawFilePath: `packages/lib/test/qunit/upstream-parity/vendor/openui5/1.144.0/raw/${SOURCE}`,
				contentSha256: "a".repeat(64),
				portFilePath: "packages/lib/test/qunit/upstream-parity/ports/openui5/1.144.0/Router.qunit.ts",
				status: "ported-subset",
				adaptations: [],
			},
		],
	};
	writeFileSync(path.join(root, MANIFEST), `${JSON.stringify(manifest, null, "\t")}\n`);
	return root;
}

/**
 * @param {string} root
 * @param {string[]} args
 */
function vendor(root, args) {
	return spawnSync(
		process.execPath,
		["--import", "./fetch-stub.mjs", "scripts/vendor-openui5-router-tests.mjs", ...args],
		{ cwd: root, encoding: "utf8" },
	);
}

/** @param {string} root */
function readManifest(root) {
	/** @type {unknown} */
	const manifest = JSON.parse(readFileSync(path.join(root, MANIFEST), "utf8"));
	/** @type {string[]} */
	const errors = [];
	assert.ok(isValidUpstreamParityManifest(manifest, errors), errors.join("; "));
	return manifest;
}

await test("--write-manifest stores the commit and the hash of the fetched file", (t) => {
	const root = tempRepo();
	t.after(() => rmSync(root, { recursive: true, force: true }));

	const result = vendor(root, ["--tag", "1.144.0", "--sha", SHA, "--write-manifest"]);

	assert.equal(result.status, 0, result.stderr);
	const manifest = readManifest(root);
	assert.equal(manifest.upstream.commitSha, SHA);
	assert.equal(manifest.files[0].contentSha256, computeSha256(UPSTREAM_TEXT));
	const raw = path.join(root, "packages/lib/test/qunit/upstream-parity/vendor/openui5/1.144.0/raw", SOURCE);
	assert.equal(readFileSync(raw, "utf8"), UPSTREAM_TEXT);
});

await test("--write-manifest to a new tag moves the raw path once the ports are migrated", (t) => {
	const root = tempRepo();
	t.after(() => rmSync(root, { recursive: true, force: true }));
	const manifest = readManifest(root);
	manifest.files[0].portFilePath = manifest.files[0].portFilePath.replace("1.144.0", "1.145.0");
	writeFileSync(path.join(root, MANIFEST), JSON.stringify(manifest));

	const result = vendor(root, ["--tag", "1.145.0", "--sha", SHA, "--write-manifest"]);

	assert.equal(result.status, 0, result.stderr);
	const updated = readManifest(root);
	assert.equal(updated.upstream.tag, "1.145.0");
	assert.equal(
		updated.files[0].rawFilePath,
		`packages/lib/test/qunit/upstream-parity/vendor/openui5/1.145.0/raw/${SOURCE}`,
	);
});

await test("--write-manifest to a new tag refuses while a port still points at the old version", (t) => {
	const root = tempRepo();
	t.after(() => rmSync(root, { recursive: true, force: true }));
	const before = readFileSync(path.join(root, MANIFEST), "utf8");

	const result = vendor(root, ["--tag", "1.145.0", "--sha", SHA, "--write-manifest"]);

	assert.equal(result.status, 1);
	assert.match(result.stderr, /Refusing to update manifest to 1\.145\.0/);
	assert.equal(readFileSync(path.join(root, MANIFEST), "utf8"), before);
});

await test("--write-manifest without --tag is rejected", (t) => {
	const root = tempRepo();
	t.after(() => rmSync(root, { recursive: true, force: true }));

	const result = vendor(root, ["--sha", SHA, "--write-manifest"]);

	assert.equal(result.status, 1);
	assert.match(result.stderr, /--write-manifest requires an explicit --tag/);
});
