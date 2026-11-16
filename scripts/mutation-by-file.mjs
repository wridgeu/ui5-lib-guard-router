// Runs Stryker once per source file, each against a fresh UI5 server, so one run never holds
// more than one file's mutants and a crash loses at most that file.
// Usage: npm run test:mutation [-- <file>...]
import { spawnSync } from "node:child_process";
import { existsSync, globSync, readdirSync, renameSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import strykerConfig from "../stryker.config.mjs";

const PORT = 8084;
const REPORT_DIR = "reports/mutation";

if (existsSync(".stryker-tmp") && readdirSync(".stryker-tmp").some((name) => name.startsWith("backup-"))) {
	console.error(
		"An interrupted Stryker run left instrumented sources behind. Copy the files from .stryker-tmp/backup-*/ " +
			"back over packages/lib/src, then delete .stryker-tmp.",
	);
	process.exit(1);
}

const include = strykerConfig.mutate.filter((pattern) => !pattern.startsWith("!"));
const exclude = new Set(
	strykerConfig.mutate.filter((pattern) => pattern.startsWith("!")).flatMap((pattern) => globSync(pattern.slice(1))),
);
const allFiles = include.flatMap((pattern) => globSync(pattern)).filter((file) => !exclude.has(file));
const requested = process.argv.slice(2).map((file) => path.normalize(file));
const files = (requested.length > 0 ? requested : allFiles).map((file) => file.split(path.sep).join("/")).toSorted();

const failed = [];
for (const file of files) {
	console.log(`\n=== Mutating ${file} ===`);
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
		],
		{ stdio: "inherit" },
	);
	if (result.status !== 0) failed.push(file);

	const name = path.basename(file, path.extname(file));
	for (const ext of ["html", "json"]) {
		const report = `${REPORT_DIR}/mutation.${ext}`;
		if (existsSync(report)) renameSync(report, `${REPORT_DIR}/${name}.${ext}`);
	}
}

console.log(
	`\nReports: ${files.map((file) => `${REPORT_DIR}/${path.basename(file, path.extname(file))}.html`).join(", ")}`,
);
if (failed.length > 0) {
	console.error(`Stryker failed for: ${failed.join(", ")}`);
	process.exitCode = 1;
}
