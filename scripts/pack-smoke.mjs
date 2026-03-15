import { execFileSync } from "node:child_process";
import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const libDir = path.join(repoRoot, "packages", "lib");

function npmArgs() {
	if (!process.env.npm_execpath) {
		throw new Error("npm_execpath is not set. Run this script via npm.");
	}

	return [process.execPath, [process.env.npm_execpath]];
}

function run(command, args, options = {}) {
	execFileSync(command, args, {
		cwd: repoRoot,
		shell: false,
		stdio: "inherit",
		...options,
	});
}

function runAndCapture(command, args, options = {}) {
	return execFileSync(command, args, {
		cwd: repoRoot,
		encoding: "utf8",
		shell: false,
		stdio: ["ignore", "pipe", "pipe"],
		...options,
	}).trim();
}

async function main() {
	const rootPackage = JSON.parse(await readFile(path.join(repoRoot, "package.json"), "utf8"));
	const tempDir = await mkdtemp(path.join(os.tmpdir(), "ui5-guard-pack-"));
	let tarballPath = "";
	const [npmCommand, npmBaseArgs] = npmArgs();

	try {
		await access(path.join(libDir, "dist", "index.d.ts"));

		const tarballName = runAndCapture(npmCommand, [...npmBaseArgs, "pack", "--silent"], { cwd: libDir });
		tarballPath = path.join(libDir, tarballName.split(/\r?\n/u).at(-1));

		await writeFile(
			path.join(tempDir, "package.json"),
			`${JSON.stringify({ private: true, type: "module" }, null, 2)}\n`,
		);
		await writeFile(
			path.join(tempDir, "tsconfig.json"),
			`${JSON.stringify(
				{
					compilerOptions: {
						target: "ES2022",
						module: "ES2022",
						moduleResolution: "Node",
						strict: true,
						skipLibCheck: true,
						types: ["@openui5/types", "ui5-lib-guard-router"],
					},
					include: ["consumer.ts"],
				},
				null,
				2,
			)}\n`,
		);
		await writeFile(
			path.join(tempDir, "consumer.ts"),
			[
				'import Router from "ui5/guard/router/Router";',
				'import library from "ui5/guard/router/library";',
				'import type { GuardRouter } from "ui5/guard/router/types";',
				"",
				"type Assert<T extends true> = T;",
				"type AssertFalse<T extends false> = T;",
				"type IsAny<T> = 0 extends 1 & T ? true : false;",
				"",
				"type _routerIsTyped = AssertFalse<IsAny<typeof Router>>;",
				"type _routerInstanceMatches = Assert<InstanceType<typeof Router> extends GuardRouter ? true : false>;",
				"",
				"declare const args: ConstructorParameters<typeof Router>;",
				"const router: GuardRouter = new Router(...args);",
				"void Router;",
				"void library;",
				"void router;",
				"",
			].join("\n"),
		);

		run(
			npmCommand,
			[
				...npmBaseArgs,
				"install",
				tarballPath,
				`@openui5/types@${rootPackage.devDependencies["@openui5/types"]}`,
				`typescript@${rootPackage.devDependencies.typescript}`,
			],
			{ cwd: tempDir },
		);

		await access(path.join(tempDir, "node_modules", "ui5-lib-guard-router", "LICENSE"));
		await access(path.join(tempDir, "node_modules", "ui5-lib-guard-router", "dist", "index.d.ts"));
		await access(
			path.join(
				tempDir,
				"node_modules",
				"ui5-lib-guard-router",
				"dist",
				"resources",
				"ui5",
				"guard",
				"router",
				"types.d.ts",
			),
		);

		run(npmCommand, [...npmBaseArgs, "exec", "tsc", "--", "--noEmit", "-p", "tsconfig.json"], { cwd: tempDir });
	} finally {
		if (tarballPath) {
			await rm(tarballPath, { force: true });
		}
		await rm(tempDir, { recursive: true, force: true });
	}
}

main().catch((error) => {
	console.error(error instanceof Error ? error.message : String(error));
	process.exitCode = 1;
});
