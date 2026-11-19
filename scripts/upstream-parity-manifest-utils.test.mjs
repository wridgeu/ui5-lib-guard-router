import assert from "node:assert/strict";
import { test } from "node:test";
import { validateUpstreamParityManifest } from "./upstream-parity-manifest-utils.mjs";

/** @param {string} repo */
const repoErrors = (repo) =>
	validateUpstreamParityManifest({
		upstream: { repo, tag: "1.144.0", commitSha: "a".repeat(40) },
		files: [],
	}).errors.filter((error) => error.includes("upstream repo"));

await test("the upstream repo is one owner and one name", () => {
	assert.deepEqual(repoErrors("a/b/c"), ["Manifest upstream repo is invalid: a/b/c"]);
	assert.deepEqual(repoErrors("UI5/openui5"), []);
	assert.deepEqual(repoErrors("UI5/"), ["Manifest upstream repo is invalid: UI5/"]);
});
