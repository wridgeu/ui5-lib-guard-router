import assert from "node:assert/strict";
import { test } from "node:test";
import { atPackageRoot } from "./root-build-manifest.mjs";

await test("the build manifest at the package root points its resource paths into dist", () => {
	const manifest = {
		project: {
			type: "library",
			resources: { configuration: { paths: { src: "resources", test: "test-resources" } } },
		},
		buildManifest: { tags: { "/resources/a.js": {} } },
	};
	const expected = structuredClone(manifest);
	expected.project.resources.configuration.paths = { src: "dist/resources", test: "dist/test-resources" };
	assert.deepEqual(JSON.parse(atPackageRoot(JSON.stringify(manifest))), expected);
});

await test("a build manifest without resource paths stops the publish", () => {
	assert.throws(() => atPackageRoot(JSON.stringify({ project: { type: "library" } })), /no project\.resources/);
});
