/**
 * Guard modules: detect a loaded module's export shape, load modules for
 * manifest guards (blocking or lazy), and run a module's guards in order.
 */
import Log from "sap/base/Log";
import type { GuardContext, GuardFn, GuardResult } from "./types";
import { isPromiseLike, LOG_COMPONENT, nameGuard } from "./GuardPipeline";
import { type GuardDescriptor, isRecord } from "./GuardConfig";

/** A guard function from a module, with the name its log messages show. */
interface NamedGuard {
	readonly name: string;
	readonly fn: GuardFn;
}

/** A guard as a module exports it: any function. Its result is checked when it runs. */
function isGuardFn(value: unknown): value is GuardFn {
	return typeof value === "function";
}

/** Log a warning about a guard module entry in the manifest. */
function guardWarning(modulePath: string, detail: string): void {
	Log.warning(`guardRouter.guards: "${modulePath}" ${detail}`, undefined, LOG_COMPONENT);
}

/** The last segment of a module path, by which the guards of the module are named. */
function moduleNameOf(modulePath: string): string {
	return modulePath.slice(modulePath.lastIndexOf("/") + 1);
}

/** The position an export key selects: a plain non-negative integer, otherwise `NaN`. */
function positionOf(exportKey: string): number {
	return /^\d+$/.test(exportKey) ? Number(exportKey) : NaN;
}

/**
 * Detect the export shape of a loaded guard module and extract guard functions.
 *
 * Shapes and the names they get (`moduleName` is the last path segment):
 * - function        → single guard, named `moduleName` (or the export key when one is given);
 *                     an export key that names a function among its own properties picks that one
 * - Array           → ordered guards, named `moduleName#index` (non-functions warned and skipped)
 * - plain object    → guards in key order, named by key (non-functions warned and skipped)
 *
 * The module is read as the value it returns to the UI5 loader, which has no ES module
 * interop. The UI5 transpiler (babel-plugin-transform-modules-ui5) returns a default export
 * as that value, with named exports beside it collapsed onto it as properties, and returns
 * the exports of a module with only named exports as the object `{ __esModule: true, ... }`.
 *
 * When `exportKey` is set, only the matching export is returned.
 * When `exportKey` is set on a function export that has no such function, the key is ignored with a debug log.
 */
export function resolveModuleExports(moduleExport: unknown, modulePath: string, exportKey?: string): NamedGuard[] {
	const moduleName = moduleNameOf(modulePath);

	if (isGuardFn(moduleExport)) {
		if (exportKey !== undefined) {
			// A named export beside the default export, which the transpiler has collapsed onto it.
			if (Object.hasOwn(moduleExport, exportKey)) {
				const named: unknown = Reflect.get(moduleExport, exportKey);
				if (isGuardFn(named)) return [{ name: exportKey, fn: named }];
			}
			Log.debug(
				`guardRouter.guards: "${modulePath}#${exportKey}" is a single function, ignoring export key`,
				undefined,
				LOG_COMPONENT,
			);
		}
		return [{ name: exportKey ?? moduleName, fn: moduleExport }];
	}

	if (Array.isArray(moduleExport)) {
		if (moduleExport.length === 0) {
			guardWarning(modulePath, "exported an empty array, skipping");
			return [];
		}

		if (exportKey !== undefined) {
			const index = positionOf(exportKey);
			if (Number.isNaN(index) || index >= moduleExport.length) {
				guardWarning(modulePath, `#${exportKey} - index out of range, skipping`);
				return [];
			}
			const entry: unknown = moduleExport[index];
			if (!isGuardFn(entry)) {
				guardWarning(modulePath, `#${exportKey} is not a function, skipping`);
				return [];
			}
			return [{ name: `${moduleName}#${exportKey}`, fn: entry }];
		}

		const results: NamedGuard[] = [];
		for (let i = 0; i < moduleExport.length; i++) {
			const entry: unknown = moduleExport[i];
			if (!isGuardFn(entry)) {
				guardWarning(modulePath, `[${i}] is not a function, skipping`);
				continue;
			}
			results.push({ name: `${moduleName}#${i}`, fn: entry });
		}
		return results;
	}

	if (isRecord(moduleExport)) {
		// The transpiler's object of a module with only named exports has `__esModule` as an enumerable first key.
		const entries = Object.entries(moduleExport).filter(([key]) => key !== "__esModule");
		if (entries.length === 0) {
			guardWarning(modulePath, "exported an empty object, skipping");
			return [];
		}

		if (exportKey !== undefined) {
			// A key wins over a position. A position that is not a number or out of range finds no entry.
			const entry: [string, unknown] | undefined = Object.hasOwn(moduleExport, exportKey)
				? [exportKey, moduleExport[exportKey]]
				: entries[positionOf(exportKey)];
			if (entry === undefined) {
				guardWarning(modulePath, `#${exportKey} - key not found, skipping`);
				return [];
			}
			const [name, value] = entry;
			if (!isGuardFn(value)) {
				guardWarning(modulePath, `#${exportKey} is not a function, skipping`);
				return [];
			}
			return [{ name, fn: value }];
		}

		const results: NamedGuard[] = [];
		for (const [key, value] of entries) {
			if (!isGuardFn(value)) {
				guardWarning(modulePath, `.${key} is not a function, skipping`);
				continue;
			}
			results.push({ name: key, fn: value });
		}
		return results;
	}

	guardWarning(modulePath, "did not export a function, array, or plain object, skipping");
	return [];
}

/** Resolve a module's guards and name each one for log output. */
function resolveNamedGuards(moduleExport: unknown, modulePath: string, exportKey?: string): GuardFn[] {
	return resolveModuleExports(moduleExport, modulePath, exportKey).map(({ name, fn }) => {
		nameGuard(fn, name);
		return fn;
	});
}

/**
 * Run guards in order, stopping at the first result that is not `true`.
 * Stays synchronous until a guard returns a Promise, like the pipeline.
 */
export function runGuardsInOrder(guards: GuardFn[], context: GuardContext): GuardResult | Promise<GuardResult> {
	for (let i = 0; i < guards.length; i++) {
		const result = guards[i](context);
		if (isPromiseLike(result)) return finishGuardsAsync(result, guards.slice(i + 1), context);
		if (result !== true) return result;
		if (context.signal.aborted) return false;
	}
	return true;
}

/** Await a pending guard result, then run the remaining guards unless the navigation was superseded. */
async function finishGuardsAsync(
	pending: PromiseLike<GuardResult>,
	remaining: GuardFn[],
	context: GuardContext,
): Promise<GuardResult> {
	const result = await pending;
	if (result !== true) return result;
	if (context.signal.aborted) return false;
	return runGuardsInOrder(remaining, context);
}

/** Load a guard module asynchronously. Warns with `failure` and rejects when the load fails. */
function loadGuardModule(modulePath: string, failure: string): Promise<unknown> {
	return new Promise((resolve, reject) => {
		sap.ui.require([modulePath], resolve, (err: Error) => {
			Log.warning(`guardRouter.guards: ${failure}`, String(err), LOG_COMPONENT);
			reject(err);
		});
	});
}

/**
 * Load the modules of all descriptors (`guardLoading: "block"`) and resolve their guards.
 *
 * Each module is loaded in its own `sap.ui.require` call, so an invalid path
 * only skips that descriptor (with a warning) instead of failing the batch.
 * Results keep declaration order.
 */
export function loadGuardModules<T extends GuardDescriptor>(
	descriptors: T[],
): Promise<{ descriptor: T; guards: GuardFn[] }[]> {
	return Promise.all(
		descriptors.map(async (descriptor) => {
			const { modulePath, exportKey } = descriptor;
			const guards = await loadGuardModule(modulePath, `failed to load module "${modulePath}", skipping`).then(
				(moduleExport) => resolveNamedGuards(moduleExport, modulePath, exportKey),
				() => [],
			);
			return { descriptor, guards };
		}),
	);
}

/**
 * Create the guards to register for one descriptor (`guardLoading: "lazy"`).
 *
 * - Cherry-pick (`module#export`): one wrapper that loads the module on first use
 *   and resolves the export once, so a missing export warns once.
 * - Bare path, module already cached (preload finished): the module's guards themselves.
 * - Bare path, cache miss: one wrapper that loads the module on first use and runs all
 *   of its guards in order. Registering them on first use would miss the current
 *   navigation, whose guard list the pipeline is already iterating. Later navigations
 *   run them synchronously.
 *
 * A wrapper is named after the module until it resolves to a single guard, then after that guard.
 */
export function createLazyGuards(descriptor: GuardDescriptor): GuardFn[] {
	const { modulePath, exportKey } = descriptor;
	const moduleName = moduleNameOf(modulePath);

	if (exportKey === undefined) {
		const cached: unknown = sap.ui.require(modulePath);
		if (cached !== undefined) return resolveNamedGuards(cached, modulePath);
	}

	let guards: GuardFn[] | undefined;
	const run = (mod: unknown, context: GuardContext): GuardResult | Promise<GuardResult> => {
		if (guards === undefined) {
			const resolved = resolveModuleExports(mod, modulePath, exportKey);
			if (resolved.length === 1) nameGuard(wrapper, resolved[0].name);
			guards = resolved.map((guard) => guard.fn);
		}
		return runGuardsInOrder(guards, context);
	};
	const wrapper = (context: GuardContext): GuardResult | PromiseLike<GuardResult> => {
		if (guards !== undefined) return runGuardsInOrder(guards, context);
		const mod: unknown = sap.ui.require(modulePath);
		if (mod !== undefined) return run(mod, context);
		return loadGuardModule(modulePath, `lazy load of "${modulePath}" failed`).then((loadedModule) =>
			context.signal.aborted ? false : run(loadedModule, context),
		);
	};
	nameGuard(wrapper, exportKey === undefined ? moduleName : `${moduleName}#${exportKey}`);
	return [wrapper];
}
