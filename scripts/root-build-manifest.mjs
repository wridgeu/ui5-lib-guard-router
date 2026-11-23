// UI5 Tooling reads the build manifest of a dependency only at <package root>/.ui5/build-manifest.json, with its paths relative to that root.
// `ui5 build --create-build-manifest` writes it to dist/.ui5, so the prepack script of packages/lib copies it to the root with dist/ prefixed to the paths.
// Neither location is configurable: @ui5/project 4 hard-codes both (ProjectBuilder._writeResults, Module._readBuildManifest).
// postpack removes the copy again, so the library and the demo app keep serving the sources during development.
// Usage (from packages/lib): node ../../scripts/root-build-manifest.mjs
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { isPlainObject } from "./upstream-parity-manifest-utils.mjs";

/**
 * Walk a dotted path of plain objects, returning `undefined` if any segment is missing or not a plain object.
 * @param {unknown} root
 * @param {...string} keys
 * @returns {Record<string, unknown> | undefined}
 */
function readNestedObject(root, ...keys) {
	let current = root;
	for (const key of keys) {
		if (!isPlainObject(current)) return undefined;
		current = current[key];
	}
	return isPlainObject(current) ? current : undefined;
}

/**
 * The build manifest of dist/.ui5 as it reads from the package root.
 * @param {string} text JSON of the build manifest that `ui5 build` wrote
 * @returns {string} JSON of the manifest with `dist/` before each resource path
 */
export function atPackageRoot(text) {
	/** @type {unknown} */
	const manifest = JSON.parse(text);
	const paths = readNestedObject(manifest, "project", "resources", "configuration", "paths");
	// A different format from a newer UI5 Tooling must stop the publish rather than ship a manifest no consumer can use.
	if (!paths) throw new Error("The build manifest has no project.resources.configuration.paths");
	for (const [key, value] of Object.entries(paths)) paths[key] = `dist/${String(value)}`;
	return `${JSON.stringify(manifest, null, "\t")}\n`;
}

if (import.meta.main) {
	mkdirSync(".ui5", { recursive: true });
	writeFileSync(".ui5/build-manifest.json", atPackageRoot(readFileSync("dist/.ui5/build-manifest.json", "utf8")));
}
