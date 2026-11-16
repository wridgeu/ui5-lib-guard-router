/**
 * Guard modules: detect a loaded module's export shape, load modules lazily,
 * and run a module's guards in order.
 */
import Log from "sap/base/Log";
import type { GuardContext, GuardFn, GuardResult } from "./types";
import { isPromiseLike } from "./GuardPipeline";
import { isRecord } from "./GuardConfig";

const LOG_COMPONENT = "ui5.guard.router.Router";

/** Log a warning about a guard module entry in the manifest. */
function guardWarning(modulePath: string, detail: string): void {
	Log.warning(`guardRouter.guards: "${modulePath}" ${detail}`, undefined, LOG_COMPONENT);
}

/**
 * Detect the export shape of a loaded guard module and extract guard functions.
 *
 * Shapes:
 * - function        → single guard
 * - Array           → ordered guards (non-functions warned and skipped)
 * - plain object    → named guards in key order (non-functions warned and skipped)
 *
 * When `exportKey` is set, only the matching export is returned.
 * When `exportKey` is set on a function export, the key is ignored with a debug warning.
 */
export function resolveModuleExports(moduleExport: unknown, modulePath: string, exportKey?: string): GuardFn[] {
	// Shape 1: function
	if (typeof moduleExport === "function") {
		if (exportKey !== undefined) {
			Log.debug(
				`guardRouter.guards: "${modulePath}#${exportKey}" is a single function, ignoring export key`,
				undefined,
				LOG_COMPONENT,
			);
		}
		return [moduleExport as GuardFn];
	}

	// Shape 2: array
	if (Array.isArray(moduleExport)) {
		if (moduleExport.length === 0) {
			guardWarning(modulePath, "exported an empty array, skipping");
			return [];
		}

		if (exportKey !== undefined) {
			const index = parseInt(exportKey, 10);
			if (Number.isNaN(index) || index < 0 || index >= moduleExport.length) {
				guardWarning(modulePath, `#${exportKey} - index out of range, skipping`);
				return [];
			}
			const entry = moduleExport[index] as unknown;
			if (typeof entry !== "function") {
				guardWarning(modulePath, `#${exportKey} is not a function, skipping`);
				return [];
			}
			return [entry as GuardFn];
		}

		const results: GuardFn[] = [];
		for (let i = 0; i < moduleExport.length; i++) {
			const entry = moduleExport[i] as unknown;
			if (typeof entry !== "function") {
				guardWarning(modulePath, `[${i}] is not a function, skipping`);
				continue;
			}
			results.push(entry as GuardFn);
		}
		return results;
	}

	// Shape 3: plain object
	if (isRecord(moduleExport)) {
		const entries = Object.entries(moduleExport);
		if (entries.length === 0) {
			guardWarning(modulePath, "exported an empty object, skipping");
			return [];
		}

		if (exportKey !== undefined) {
			let value: unknown = moduleExport[exportKey];
			if (value === undefined) {
				const index = parseInt(exportKey, 10);
				if (!Number.isNaN(index) && index >= 0 && index < entries.length) {
					value = entries[index][1];
				}
			}
			if (value === undefined) {
				guardWarning(modulePath, `#${exportKey} - key not found, skipping`);
				return [];
			}
			if (typeof value !== "function") {
				guardWarning(modulePath, `#${exportKey} is not a function, skipping`);
				return [];
			}
			return [value as GuardFn];
		}

		const results: GuardFn[] = [];
		for (const [key, value] of entries) {
			if (typeof value !== "function") {
				guardWarning(modulePath, `.${key} is not a function, skipping`);
				continue;
			}
			results.push(value as GuardFn);
		}
		return results;
	}

	guardWarning(modulePath, "did not export a function, array, or plain object, skipping");
	return [];
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

/** Load a guard module asynchronously. Rejects (with a warning) when the load fails. */
export function loadGuardModule(modulePath: string): Promise<unknown> {
	return new Promise((resolve, reject) => {
		sap.ui.require([modulePath], resolve, (err: Error) => {
			Log.warning(`guardRouter.guards: lazy load of "${modulePath}" failed`, String(err), LOG_COMPONENT);
			reject(err);
		});
	});
}
