/**
 * Parsing and validation of the `guardRouter` config block.
 */
import Log from "sap/base/Log";
import type {
	GuardLoading,
	GuardRouterLogLevel,
	Inheritance,
	NavToPreflightMode,
	UnknownRouteRegistrationPolicy,
} from "./types";
import { LOG_COMPONENT } from "./GuardPipeline";

/** Type guard for plain objects. */
export function isRecord(value: unknown): value is Record<string, unknown> {
	if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
	const proto: unknown = Object.getPrototypeOf(value);
	return proto === Object.prototype || proto === null;
}

/** Create a type-narrowing validator for a finite set of string literal values. */
function isOneOf<T extends string>(...values: T[]): (v: unknown) => v is T {
	const set: ReadonlySet<string> = new Set(values);
	return (v: unknown): v is T => typeof v === "string" && set.has(v);
}

const isUnknownRouteRegistrationPolicy = isOneOf<UnknownRouteRegistrationPolicy>("ignore", "warn", "throw");
const isNavToPreflightMode = isOneOf<NavToPreflightMode>("guard", "bypass", "off");
const isGuardLoading = isOneOf<GuardLoading>("block", "lazy");
const isInheritance = isOneOf<Inheritance>("none", "pattern-tree");

const LOG_LEVELS = {
	error: Log.Level.ERROR,
	warning: Log.Level.WARNING,
	info: Log.Level.INFO,
	debug: Log.Level.DEBUG,
} satisfies Record<GuardRouterLogLevel, unknown>;

const isLogLevel = (v: unknown): v is GuardRouterLogLevel => typeof v === "string" && Object.hasOwn(LOG_LEVELS, v);

/** Parsed guard declaration from the manifest `guards` block. */
export interface GuardDescriptor {
	readonly route: string; // "*" for global, route name for per-route
	readonly type: "enter" | "leave";
	readonly modulePath: string;
	readonly exportKey?: string;
}

/**
 * Resolve a guard module path to a slash-separated AMD module path.
 *
 * Inspired by `sap.ui.core.routing.Target._getEffectiveObjectName()`,
 * which skips namespace prepending for `"module:"`-prefixed paths. This
 * function goes further: it also converts dots to slashes in a single
 * step, so both dot notation (`module:some.lib.guard`) and slash
 * notation (`module:some/lib/guard`) are accepted.
 *
 * - Paths prefixed with `"module:"` are treated as absolute (the prefix
 *   is stripped, dots become slashes).
 * - All other paths are prefixed with the component namespace, then dots
 *   become slashes.
 */
function resolveGuardModulePath(dotPath: string, componentNamespace: string): string {
	if (dotPath.startsWith("module:")) {
		return dotPath.slice("module:".length).replace(/\./g, "/");
	}
	const fullDotPath = componentNamespace ? componentNamespace + "." + dotPath : dotPath;
	return fullDotPath.replace(/\./g, "/");
}

/**
 * Split a manifest guard entry on the first `#` to separate the module path
 * from an optional export key.
 */
function parseGuardEntry(entry: string, componentNamespace: string): { modulePath: string; exportKey?: string } | null {
	const hashIndex = entry.indexOf("#");
	const rawPath = hashIndex === -1 ? entry : entry.slice(0, hashIndex);
	if (rawPath.length === 0 || (rawPath.startsWith("module:") && rawPath.length === "module:".length)) {
		return null;
	}
	const exportKey = hashIndex === -1 ? undefined : entry.slice(hashIndex + 1);

	return { modulePath: resolveGuardModulePath(rawPath, componentNamespace), exportKey };
}

/**
 * Parse the `guards` block from the guardRouter config into an array of
 * {@link GuardDescriptor} objects.
 *
 * Handles:
 * - `"*"` key with `string[]` -> global enter guards
 * - Route name with `string[]` (shorthand) -> enter guards
 * - Route name with `{ enter: [...], leave: [...] }` -> enter + leave guards
 * - `"*"` with object form -> log info, treat enter as global
 * - `"*"` leave -> warn, skip (global leave guards not supported)
 * - Invalid entries, object values that are not arrays, unknown object keys -> warn, skip
 */
function parseGuardDescriptors(guards: unknown, componentNamespace: string): GuardDescriptor[] {
	if (!isRecord(guards)) {
		Log.warning("guardRouter.guards is not a plain object, skipping", JSON.stringify(guards), LOG_COMPONENT);
		return [];
	}

	const descriptors: GuardDescriptor[] = [];

	function pushEntries(entries: unknown[], route: string, type: "enter" | "leave", label: string): void {
		for (const entry of entries) {
			const parsed = typeof entry === "string" ? parseGuardEntry(entry, componentNamespace) : null;
			if (!parsed) {
				Log.warning(
					`guardRouter.guards${label}: invalid entry, skipping`,
					JSON.stringify(entry),
					LOG_COMPONENT,
				);
				continue;
			}
			descriptors.push({ route, type, ...parsed });
		}
	}

	for (const [key, value] of Object.entries(guards)) {
		if (Array.isArray(value)) {
			pushEntries(value, key, "enter", `["${key}"]`);
		} else if (isRecord(value)) {
			if (key === "*" && value.leave !== undefined) {
				Log.warning(
					'guardRouter.guards["*"].leave: global leave guards are not supported, skipping',
					undefined,
					LOG_COMPONENT,
				);
			}

			for (const name of Object.keys(value)) {
				if (name === "enter" || name === "leave") continue;
				Log.warning(
					`guardRouter.guards["${key}"].${name}: unknown key, expected enter or leave, skipping`,
					undefined,
					LOG_COMPONENT,
				);
			}

			for (const type of ["enter", "leave"] as const) {
				const entries = value[type];
				if (entries === undefined || (key === "*" && type === "leave")) continue;
				if (!Array.isArray(entries)) {
					Log.warning(
						`guardRouter.guards["${key}"].${type}: expected string[], skipping`,
						JSON.stringify(entries),
						LOG_COMPONENT,
					);
					continue;
				}
				if (key === "*") {
					Log.info(
						'guardRouter.guards["*"]: object form; treating enter as global',
						undefined,
						LOG_COMPONENT,
					);
				}
				pushEntries(entries, key, type, `["${key}"].${type}`);
			}
		} else {
			Log.warning(
				`guardRouter.guards["${key}"]: expected string[] or { enter?, leave? }, skipping`,
				JSON.stringify(value),
				LOG_COMPONENT,
			);
		}
	}

	return descriptors;
}

export interface ResolvedGuardRouterOptions {
	readonly unknownRouteRegistration: UnknownRouteRegistrationPolicy;
	readonly navToPreflight: NavToPreflightMode;
	readonly guardLoading: GuardLoading;
	readonly inheritance: Inheritance;
}

const DEFAULT_OPTIONS: ResolvedGuardRouterOptions = {
	unknownRouteRegistration: "warn",
	navToPreflight: "guard",
	guardLoading: "lazy",
	inheritance: "none",
};

function applyOption<K extends keyof ResolvedGuardRouterOptions>(
	raw: Record<string, unknown>,
	key: K,
	guard: (v: unknown) => v is ResolvedGuardRouterOptions[K],
	target: { -readonly [P in keyof ResolvedGuardRouterOptions]: ResolvedGuardRouterOptions[P] },
): void {
	const value = raw[key];
	if (value === undefined) return;
	if (guard(value)) {
		target[key] = value;
	} else {
		Log.warning(`guardRouter.${key} has invalid value, using default`, JSON.stringify(value), LOG_COMPONENT);
	}
}

/** Raise the page-wide level of the router's log component; a more verbose level is kept. */
function applyLogLevel(value: unknown): void {
	if (value === undefined) return;
	if (!isLogLevel(value)) {
		// An error, not a warning: the level is not raised, so a warning would be filtered out at the default ERROR level.
		Log.error("guardRouter.logLevel has invalid value, ignoring it", JSON.stringify(value), LOG_COMPONENT);
		return;
	}
	const level = LOG_LEVELS[value];
	if (level > Log.getLevel(LOG_COMPONENT)) Log.setLevel(level, LOG_COMPONENT);
}

function normalizeGuardRouterOptions(raw: unknown): ResolvedGuardRouterOptions {
	if (!isRecord(raw)) {
		if (raw !== undefined) {
			Log.warning("guardRouter config is not a plain object, using defaults", JSON.stringify(raw), LOG_COMPONENT);
		}
		return DEFAULT_OPTIONS;
	}

	// First, so that the warnings about the other options are logged at the new level.
	applyLogLevel(raw.logLevel);
	const result = { ...DEFAULT_OPTIONS };
	applyOption(raw, "unknownRouteRegistration", isUnknownRouteRegistrationPolicy, result);
	applyOption(raw, "navToPreflight", isNavToPreflightMode, result);
	applyOption(raw, "guardLoading", isGuardLoading, result);
	applyOption(raw, "inheritance", isInheritance, result);
	return result;
}

/** Parse the `routeMeta` block: one frozen plain object per route name. */
function parseRouteMeta(raw: unknown): Map<string, Readonly<Record<string, unknown>>> {
	const routeMeta = new Map<string, Readonly<Record<string, unknown>>>();
	if (raw === undefined) return routeMeta;
	if (!isRecord(raw)) {
		Log.warning("guardRouter.routeMeta: expected object, skipping", JSON.stringify(raw), LOG_COMPONENT);
		return routeMeta;
	}
	for (const [routeName, meta] of Object.entries(raw)) {
		if (isRecord(meta)) {
			routeMeta.set(routeName, Object.freeze({ ...meta }));
		} else {
			Log.warning(
				`guardRouter.routeMeta["${routeName}"]: expected object, skipping`,
				JSON.stringify(meta),
				LOG_COMPONENT,
			);
		}
	}
	return routeMeta;
}

/** The `guardRouter` config block, validated. Invalid parts are warned about and dropped. */
interface ParsedGuardRouterConfig {
	readonly options: ResolvedGuardRouterOptions;
	readonly routeMeta: Map<string, Readonly<Record<string, unknown>>>;
	readonly guards: GuardDescriptor[];
}

/**
 * Parse the `guardRouter` config block: options, `routeMeta` and the manifest `guards`.
 * Guard module paths are resolved against `componentNamespace` (the owner's `sap.app/id`).
 * Side effect: a valid `logLevel` raises the page-wide level of the router's log component.
 */
export function parseGuardRouterConfig(raw: unknown, componentNamespace: string): ParsedGuardRouterConfig {
	const options = normalizeGuardRouterOptions(raw);
	if (!isRecord(raw)) return { options, routeMeta: new Map(), guards: [] };
	return {
		options,
		routeMeta: parseRouteMeta(raw.routeMeta),
		guards: raw.guards === undefined ? [] : parseGuardDescriptors(raw.guards, componentNamespace),
	};
}
