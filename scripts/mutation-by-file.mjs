// Runs Stryker once per source file, each against a fresh UI5 server, so one run never holds
// more than one file's mutants and a crash loses at most that file.
// Results are kept per file, so a stopped or repeated run only tests what is missing or changed.
// Usage: npm run test:mutation [-- [--force] <file>...]
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
	existsSync,
	globSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	renameSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";
import strykerConfig from "../stryker.config.mjs";

const PORT = 8084;
const REPORT_DIR = "reports/mutation";
const INCREMENTAL_DIR = `${REPORT_DIR}/incremental`;

if (existsSync(".stryker-tmp") && readdirSync(".stryker-tmp").some((name) => name.startsWith("backup-"))) {
	console.error(
		"An interrupted Stryker run left instrumented sources behind. Copy the files from .stryker-tmp/backup-*/ " +
			"back over packages/lib/src, then delete .stryker-tmp.",
	);
	process.exit(1);
}

// Stryker types every option as optional, and so every entry of an array.
const mutate = (strykerConfig.mutate ?? []).filter((pattern) => typeof pattern === "string");
const include = mutate.filter((pattern) => !pattern.startsWith("!"));
const exclude = new Set(
	mutate.filter((pattern) => pattern.startsWith("!")).flatMap((pattern) => globSync(pattern.slice(1))),
);
const allFiles = include.flatMap((pattern) => globSync(pattern)).filter((file) => !exclude.has(file));
const args = process.argv.slice(2);
const force = args.includes("--force");
const requested = args.filter((arg) => arg !== "--force").map((file) => path.normalize(file));
const files = (requested.length > 0 ? requested : allFiles).map((file) => file.split(path.sep).join("/")).toSorted();
// A run limited to line ranges gets its own name, so its results and report never replace the whole file's.
function runName(file) {
	const [source, ...ranges] = file.split(":");
	const name = path.basename(source, ".ts");
	return ranges.length > 0 ? `${name}.${ranges.join(":").replace(/[^\d-]+/g, "_")}` : name;
}

// Stryker sees the QUnit run as one test, so it cannot tell which kept results a test change
// invalidates. Any change to the tests therefore discards the kept results.
const testsHash = createHash("sha256");
const testFiles = globSync("packages/lib/test/**/*", { withFileTypes: true })
	.filter((entry) => entry.isFile())
	.map((entry) => path.join(entry.parentPath, entry.name).split(path.sep).join("/"));
for (const file of testFiles.toSorted()) {
	testsHash.update(file).update(readFileSync(file));
}
const testsFingerprint = testsHash.digest("hex");
mkdirSync(INCREMENTAL_DIR, { recursive: true });

const failed = [];
for (const file of files) {
	console.log(`\n=== Mutating ${file} ===`);
	const key = runName(file);
	const incrementalFile = `${INCREMENTAL_DIR}/${key}.json`;
	const fingerprintFile = `${INCREMENTAL_DIR}/${key}.tests-sha256`;
	const keptFingerprint = existsSync(fingerprintFile) ? readFileSync(fingerprintFile, "utf8") : "";
	if (force || keptFingerprint !== testsFingerprint) rmSync(incrementalFile, { force: true });
	writeFileSync(fingerprintFile, testsFingerprint);
	// Each wdio run deletes its own Chrome profile, but a run Stryker kills on timeout cannot.
	const chromeProfiles = mkdtempSync(path.join(tmpdir(), "ui5-guard-mutation-"));
	const result = spawnSync(
		process.execPath,
		[
			"scripts/run-with-server.mjs",
			"--ready-url",
			`http://localhost:${PORT}`,
			"--server-script",
			"start:lib:mutation",
			"--test-script",
			"stryker",
			"--test-base-url",
			`http://localhost:${PORT}`,
			"--",
			"--mutate",
			file,
			"--incremental",
			"--incrementalFile",
			incrementalFile,
		],
		{ stdio: "inherit", env: { ...process.env, MUTATION_CHROME_PROFILES: chromeProfiles } },
	);
	rmSync(chromeProfiles, { recursive: true, force: true, maxRetries: 5 });
	if (result.status !== 0) failed.push(file);

	for (const ext of ["html", "json"]) {
		const report = `${REPORT_DIR}/mutation.${ext}`;
		if (existsSync(report)) renameSync(report, `${REPORT_DIR}/${key}.${ext}`);
	}
}

console.log(`\nReports: ${files.map((file) => `${REPORT_DIR}/${runName(file)}.html`).join(", ")}`);
if (failed.length > 0) {
	console.error(`Stryker failed for: ${failed.join(", ")}`);
	process.exitCode = 1;
}
