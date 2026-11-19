// Checks every Mermaid block of the docs: it parses, and the library code it names exists.
// Usage: npm run check:diagrams
import { execFileSync } from "node:child_process";
import { globSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseHTML } from "linkedom";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const LIB_SRC = "packages/lib/src";
const read = (file) => readFileSync(path.join(repoRoot, file), "utf8");

// Mermaid sanitizes labels with DOMPurify, which takes the DOM from `window` when it is loaded.
const { window } = parseHTML("<html><body></body></html>");
Object.assign(globalThis, { window, document: window.document });
const { default: mermaid } = await import("mermaid");

const docs = execFileSync("git", ["ls-files", "*.md"], { cwd: repoRoot, encoding: "utf8" }).split("\n").filter(Boolean);
const identifier = /[A-Za-z_$][\w$]*/g;
const sourceNames = new Set(
	globSync("**/*.ts", { cwd: path.join(repoRoot, LIB_SRC) }).flatMap((file) =>
		read(path.join(LIB_SRC, file)).match(identifier),
	),
);

const errors = [];
let blocks = 0;
let names = 0;
for (const doc of docs) {
	const text = read(doc);
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

		// Rule 2: a name in backticks is a name of the library source.
		for (const [, code] of diagram.matchAll(/`([^`\n]+)`/g)) {
			for (const [name] of code.matchAll(identifier)) {
				names++;
				if (!sourceNames.has(name)) {
					errors.push(`${where}: the Mermaid block names \`${name}\`, which ${LIB_SRC} does not have`);
				}
			}
		}
	}
}
// None found means the fence or the backtick format changed and nothing above checked it.
if (blocks === 0) errors.push("no Mermaid block found in the docs");
if (names === 0) errors.push("no name in backticks found in a Mermaid block");

if (errors.length > 0) {
	console.error(`Diagram check failed:\n- ${errors.join("\n- ")}`);
	process.exit(1);
}
console.log(`Diagrams: ${blocks} Mermaid blocks in ${docs.length} docs parse, ${names} names found in ${LIB_SRC}`);
