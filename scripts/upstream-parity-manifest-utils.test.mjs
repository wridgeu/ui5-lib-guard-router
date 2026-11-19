import assert from "node:assert/strict";
import { test } from "node:test";
import { isValidUpstreamParityManifest } from "./upstream-parity-manifest-utils.mjs";

/**
 * @param {unknown} manifest
 * @returns {string[]}
 */
function errorsOf(manifest) {
	/** @type {string[]} */
	const errors = [];
	isValidUpstreamParityManifest(manifest, errors);
	return errors;
}

const upstream = { repo: "UI5/openui5", tag: "1.144.0", commitSha: "a".repeat(40) };
const file = {
	id: "Router",
	sourcePath: "src/Router.qunit.js",
	rawFilePath: "vendor/openui5/1.144.0/raw/src/Router.qunit.js",
	contentSha256: "a".repeat(64),
	portFilePath: "ports/1.144.0/Router.qunit.ts",
	status: "ported",
	adaptations: [],
};

/** @param {string} repo */
const repoErrors = (repo) =>
	errorsOf({ upstream: { ...upstream, repo }, files: [file] }).filter((error) => error.includes("upstream repo"));

await test("the upstream repo is one owner and one name", () => {
	assert.deepEqual(repoErrors("a/b/c"), ["Manifest upstream repo is invalid: a/b/c"]);
	assert.deepEqual(repoErrors("UI5/openui5"), []);
	assert.deepEqual(repoErrors("UI5/"), ["Manifest upstream repo is invalid: UI5/"]);
});

await test("a valid manifest has no errors, and a checksum or a status that is no string has one", () => {
	assert.deepEqual(errorsOf({ upstream, files: [file] }), []);
	assert.deepEqual(errorsOf({ upstream, files: [{ ...file, contentSha256: ["a".repeat(64)] }] }), [
		"Manifest entry has invalid contentSha256: Router",
	]);
	assert.deepEqual(errorsOf({ upstream, files: [{ ...file, status: ["ported"] }] }), [
		'Manifest entry has unsupported status ["ported"]: Router',
	]);
});
