import { execFileSync } from "node:child_process";
import { mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import rootPackage from "../package.json" with { type: "json" };
import { npmArgs } from "./npm-command.mjs";

const repoRoot = path.resolve(import.meta.dirname, "..");
const libDir = path.join(repoRoot, "packages", "lib");

/**
 * @param {string} command
 * @param {string[]} args
 * @param {{ cwd?: string }} options
 */
function run(command, args, options = {}) {
	execFileSync(command, args, {
		cwd: repoRoot,
		shell: false,
		stdio: "inherit",
		...options,
	});
}

/**
 * @param {string} command
 * @param {string[]} args
 * @param {{ cwd?: string }} options
 */
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
	const tempDir = await mkdtemp(path.join(os.tmpdir(), "ui5-guard-pack-"));
	let tarballPath = "";
	const [npmCommand, npmBaseArgs] = npmArgs();

	try {
		await stat(path.join(libDir, "dist", "index.d.ts"));

		const tarballName = runAndCapture(npmCommand, [...npmBaseArgs, "pack", "--silent"], { cwd: libDir });
		tarballPath = path.join(libDir, tarballName.slice(tarballName.lastIndexOf("\n") + 1));

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
						moduleResolution: "Bundler",
						strict: true,
						// @openui5/types uses the jQuery and QUnit globals without referencing their types.
						types: ["@openui5/types", "jquery", "qunit", "ui5-lib-guard-router"],
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
				'import NavigationOutcome from "ui5/guard/router/NavigationOutcome";',
				'import type UIComponent from "sap/ui/core/UIComponent";',
				"import type {",
				"\tGuardContext,",
				"\tGuardFn,",
				"\tGuardRedirect,",
				"\tGuardResult,",
				"\tGuardRouter,",
				"\tGuardRouterConfig,",
				"\tGuardRouterOptions,",
				"\tInheritance,",
				"\tLeaveGuardFn,",
				"\tNavigationResult,",
				"\tRouteGuardConfig,",
				"\tUnknownRouteRegistrationPolicy,",
				'} from "ui5/guard/router/types";',
				"",
				"type Assert<T extends true> = T;",
				"type AssertFalse<T extends false> = T;",
				"type IsAny<T> = 0 extends 1 & T ? true : false;",
				"",
				"type _routerIsTyped = AssertFalse<IsAny<typeof Router>>;",
				"type _navigationOutcomeIsTyped = AssertFalse<IsAny<typeof NavigationOutcome>>;",
				"type _routerInstanceMatches = Assert<InstanceType<typeof Router> extends GuardRouter ? true : false>;",
				"type _navigationResultStatusMatches = Assert<NavigationResult['status'] extends (typeof NavigationOutcome)[keyof typeof NavigationOutcome] ? true : false>;",
				"",
				"declare const context: GuardContext;",
				"declare const args: ConstructorParameters<typeof Router>;",
				"const enterGuard: GuardFn = (guardContext) => {",
				'\tconst redirect: GuardRedirect = { route: guardContext.toRoute || "home" };',
				"\tconst result: GuardResult = redirect;",
				"\treturn result;",
				"};",
				"const leaveGuard: LeaveGuardFn = (guardContext) => guardContext.fromRoute !== guardContext.toRoute;",
				"const config: RouteGuardConfig = { beforeEnter: enterGuard, beforeLeave: leaveGuard };",
				'const settlement: NavigationResult = { status: NavigationOutcome.Committed, route: "", hash: "" };',
				"const router: GuardRouter = new Router(...args);",
				'const meta: Readonly<Record<string, unknown>> = router.getRouteMeta("home");',
				'router.setRouteMeta("home", { requiresAuth: true });',
				'const inheritance: Inheritance = "pattern-tree";',
				'const policy: UnknownRouteRegistrationPolicy = "warn";',
				"const opts: GuardRouterOptions = { inheritance, unknownRouteRegistration: policy };",
				"const toMeta: Readonly<Record<string, unknown>> = context.toMeta;",
				"const fromMeta: Readonly<Record<string, unknown>> = context.fromMeta;",
				"const owner: UIComponent | undefined = context.ownerComponent;",
				'const routerConfig: GuardRouterConfig = { async: true, viewType: "XML", guardRouter: opts };',
				"const configuredRouter: GuardRouter = new Router([], routerConfig);",
				"void context;",
				"void config;",
				"void settlement;",
				"void Router;",
				"void NavigationOutcome;",
				"void library;",
				"void enterGuard;",
				"void leaveGuard;",
				"void router;",
				"void meta;",
				"void opts;",
				"void toMeta;",
				"void fromMeta;",
				"void owner;",
				"void configuredRouter;",
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

		await stat(path.join(tempDir, "node_modules", "ui5-lib-guard-router", "LICENSE"));
		await stat(path.join(tempDir, "node_modules", "ui5-lib-guard-router", "dist", "index.d.ts"));
		await stat(
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
