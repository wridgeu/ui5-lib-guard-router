// Checks the layout of the QUnit tests and what the docs say about test files.
// Usage: npm run check:layout
import { execFileSync } from "node:child_process";
import { existsSync, globSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import suite from "../packages/lib/test/qunit/testsuite.qunit.ts";
import { testTitles } from "./test-titles.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const QUNIT = "packages/lib/test/qunit";
/** @param {string} file */
const read = (file) => readFileSync(path.join(repoRoot, file), "utf8");
/** @param {string} file */
const posix = (file) => file.split(path.sep).join("/");
/** @type {string[]} */
const errors = [];

// Rule 1: the test files on disk are the files the test suite registers, each on one page.
// Rule 2: a page is a folder, so a page only lists files of its own folder.
const registered = new Map();
for (const [page, { files }] of Object.entries(suite.tests)) {
	for (const file of files) {
		if (file.includes("/")) {
			errors.push(`Page "${page}" lists "${file}": a page lists the files of its own folder, by name`);
			continue;
		}
		const testFile = `${page}/${file}.qunit.ts`;
		if (registered.has(testFile)) errors.push(`${testFile} is listed twice in testsuite.qunit.ts`);
		registered.set(testFile, page);
		if (!existsSync(path.join(repoRoot, QUNIT, testFile))) {
			errors.push(`Page "${page}" lists "${file}", but ${QUNIT}/${testFile} does not exist`);
		}
	}
}
// The vendored upstream tests and their ports are loaded by upstream-parity/Current.qunit.ts.
const onDisk = globSync("**/*.qunit.ts", { cwd: path.join(repoRoot, QUNIT) })
	.map(posix)
	.filter((file) => file !== "testsuite.qunit.ts" && !/^(fixtures|upstream-parity\/(ports|vendor))\//.test(file));
for (const file of onDisk) {
	if (!registered.has(file)) {
		errors.push(
			`${QUNIT}/${file} is on no test page: list it in testsuite.qunit.ts under "${path.posix.dirname(file)}"`,
		);
	}
}

// Rule 3: a QUnit module lives in one file, so its name identifies the file of a failing test.
const moduleCall = /\bQUnit\.module\(\s*(?:"((?:\\.|[^"\\])*)"|(\S))/g;
const moduleFiles = new Map();
const ports = globSync("upstream-parity/ports/**/*.qunit.ts", { cwd: path.join(repoRoot, QUNIT) }).map(posix);
for (const file of [...onDisk, ...ports]) {
	for (const [, name, other] of read(`${QUNIT}/${file}`).matchAll(moduleCall)) {
		if (other !== undefined) {
			errors.push(`${QUNIT}/${file}: a QUnit.module() name is not a plain string, so it cannot be checked`);
		} else if (moduleFiles.has(name) && moduleFiles.get(name) !== file) {
			errors.push(`QUnit module "${name}" is in ${moduleFiles.get(name)} and in ${file}`);
		} else {
			moduleFiles.set(name, file);
		}
	}
}

// CHANGELOG.md is generated; investigations record the files as they were when they were written.
const docs = execFileSync("git", ["ls-files", "*.md"], { cwd: repoRoot, encoding: "utf8" })
	.split("\n")
	.filter((file) => file && !/(^|\/)CHANGELOG\.md$|\/vendor\/|^docs\/investigations\//.test(file));

// Rule 4: a file of this repository's packages that a doc names exists. Docs also name files
// in the packages/ folders of other projects.
const workspaces = readdirSync(path.join(repoRoot, "packages")).join("|");
const packageFile = new RegExp(String.raw`\bpackages/(?:${workspaces})/[\w./@-]*\.(?:ts|mjs|json)\b`, "g");
for (const doc of docs) {
	for (const [mentioned] of read(doc).matchAll(packageFile)) {
		if (!existsSync(path.join(repoRoot, mentioned))) errors.push(`${doc} names ${mentioned}, which does not exist`);
	}
}

// Rule 5: a citation `<test file>: <test title>` names a test of that file. The file is given
// by its path below the QUnit folder or by its name, if no other test file has that name. A test
// of the demo app (`*.e2e.ts`) is cited the same way.
const E2E = "packages/demo-app/test";
const e2eFiles = globSync("**/*.e2e.ts", { cwd: path.join(repoRoot, E2E) }).map((file) => `${E2E}/${posix(file)}`);
const testFiles = [...[...onDisk, ...ports].map((file) => `${QUNIT}/${file}`), ...e2eFiles];
/** @param {string} file */
const titlesOf = (file) => testTitles(read(file));
const citation = /`([^`\s]+\.(?:qunit|e2e)\.ts): ([^`]+)`/g;
// The same for a module: `<test file>`, module "<name>", or: module "<name>" of `<test file>`.
const moduleCitations = [
	/`(?<cited>[^`\s]+\.qunit\.ts)`, module "(?<name>[^"]+)"/g,
	/\bmodule "(?<name>[^"]+)" of `(?<cited>[^`\s]+\.qunit\.ts)`/gi,
];
/**
 * @param {string} doc
 * @param {string} cited
 */
function citedFile(doc, cited) {
	const files = testFiles.filter(
		(file) => file === cited || file === `${QUNIT}/${cited}` || path.posix.basename(file) === cited,
	);
	if (files.length !== 1) errors.push(`${doc} cites ${cited}, which names ${files.length} test files`);
	return files.length === 1 ? files[0] : undefined;
}
for (const doc of docs) {
	// A citation in running text may be wrapped.
	const text = read(doc).replace(/\s+/g, " ");
	for (const [, cited, title] of text.matchAll(citation)) {
		const file = citedFile(doc, cited);
		if (file && !titlesOf(file).has(title.replaceAll("\\|", "|"))) {
			errors.push(`${doc} cites a test that ${file} does not have: "${title}"`);
		}
	}
	for (const pattern of moduleCitations) {
		for (const { groups } of text.matchAll(pattern)) {
			if (!groups) continue;
			const file = citedFile(doc, groups.cited);
			if (file && `${QUNIT}/${moduleFiles.get(groups.name)}` !== file) {
				errors.push(`${doc} cites a module that ${file} does not have: "${groups.name}"`);
			}
		}
	}
}
// The parity table of the library README is made of such citations: none found means the
// format changed and nothing above checked it.
const readme = read("packages/lib/README.md");
const parityStart = readme.indexOf("\n## Compatibility with `sap.m.routing.Router`");
const paritySection = readme.slice(parityStart, readme.indexOf("\n## ", parityStart + 1));
if (parityStart === -1 || ![...paritySection.matchAll(citation)].length) {
	errors.push('packages/lib/README.md: no test citation found in "Compatibility with `sap.m.routing.Router`"');
}

if (errors.length > 0) {
	console.error(`Test layout check failed:\n- ${errors.join("\n- ")}`);
	process.exit(1);
}
console.log(
	`Test layout: ${registered.size} test files on ${Object.keys(suite.tests).length} pages, ${docs.length} docs checked`,
);
