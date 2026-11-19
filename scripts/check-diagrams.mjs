// Checks every Mermaid block of the docs: it parses, has no backtick, and the library code it names exists (comments name none).
// Usage: npm run check:diagrams
import { execFileSync } from "node:child_process";
import { globSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseHTML } from "linkedom";
import { sourceNames } from "./source-names.mjs";

/** A call (`name(`) or a private name (`_name`) in a diagram. */
const CODE_NAME = /(?<![\w$.])(?:[\w$]+\.)*(_[\w$]+|[A-Za-z$][\w$]*(?=\())/g;
/** Names of UI5, the launchpad and the browser that the diagrams call and the library source does not. */
const EXTERNAL_NAMES = new Set(["activate", "deactivate", "onActivate", "onDeactivate", "confirm", "_handleDataLoss"]);

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const LIB_SRC = "packages/lib/src";
/** @param {string} file */
const read = (file) => readFileSync(path.join(repoRoot, file), "utf8");

// Mermaid sanitizes labels with DOMPurify, which takes the DOM from `window` when it is loaded.
const { window } = parseHTML("<html><body></body></html>");
Object.assign(globalThis, { window, document: window.document });
const { default: mermaid } = await import("mermaid");

const docs = execFileSync("git", ["ls-files", "*.md"], { cwd: repoRoot, encoding: "utf8" }).split("\n").filter(Boolean);
const libNames = new Set(
	globSync("**/*.ts", { cwd: path.join(repoRoot, LIB_SRC) }).flatMap((file) =>
		sourceNames(read(path.join(LIB_SRC, file))),
	),
);

const errors = [];
let blocks = 0;
let names = 0;
let docsWithBlocks = 0;
for (const doc of docs) {
	const text = read(doc);
	const blocksBefore = blocks;
	for (const match of text.matchAll(/^[ \t]*```mermaid[ \t]*\r?\n([\s\S]*?)^[ \t]*```[ \t]*$/gm)) {
		const [, diagram] = match;
		const where = `${doc}:${text.slice(0, match.index).split("\n").length}`;
		blocks++;

		// Rule 1: the diagram is valid Mermaid.
		try {
			await mermaid.parse(diagram);
		} catch (error) {
			errors.push(
				`${where}: the Mermaid block does not parse: ${error instanceof Error ? error.message : String(error)}`,
			);
		}

		// Rule 2: GitHub prints a backtick in a label as it is, and rejects a label that starts with one.
		if (diagram.includes("`")) errors.push(`${where}: the Mermaid block has a backtick, write the name plainly`);

		// Rule 3: a call `name(` and a private name `_name` are names of the library source, or listed in EXTERNAL_NAMES.
		// Only labels are read: a flowchart node `id("label")` is no call.
		const labels = /^\s*flowchart/.test(diagram)
			? [...diagram.matchAll(/"([^"\n]*)"/g)].map(([, label]) => label)
			: [...diagram.matchAll(/^[^:\n]*:(.*)$/gm)].map(([, label]) => label);
		for (const [, name] of labels.join("\n").matchAll(CODE_NAME)) {
			names++;
			if (!libNames.has(name) && !EXTERNAL_NAMES.has(name)) {
				errors.push(`${where}: the Mermaid block names ${name}, which ${LIB_SRC} does not have`);
			}
		}
	}
	if (blocks > blocksBefore) docsWithBlocks++;
}
// None found means the fence or the name format changed and nothing above checked it.
if (blocks === 0) errors.push("no Mermaid block found in the docs");
if (names === 0) errors.push("no call or private name found in a Mermaid block");

if (errors.length > 0) {
	console.error(`Diagram check failed:\n- ${errors.join("\n- ")}`);
	process.exit(1);
}
console.log(`Diagrams: ${blocks} Mermaid blocks in ${docsWithBlocks} docs parse, ${names} names found in ${LIB_SRC}`);
