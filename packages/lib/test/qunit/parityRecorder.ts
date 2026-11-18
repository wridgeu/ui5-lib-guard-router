import Log, { type Entry } from "sap/base/Log";
import type Event from "sap/ui/base/Event";
import ManagedObject from "sap/ui/base/ManagedObject";
import BaseObject from "sap/ui/base/Object";
import HashChanger from "sap/ui/core/routing/HashChanger";
import type Router from "sap/ui/core/routing/Router";
import { flushPromises } from "./testHelpers";

/**
 * Recorders for differential tests against the native router. Each appends one line per observed
 * behavior to a shared trace, in the order it happened. Two runs behave alike when their traces
 * are equal. Lines are strings so that a failing comparison shows a readable diff.
 */

const ROUTER_EVENTS = ["beforeRouteMatched", "routeMatched", "routePatternMatched", "bypassed", "titleChanged"];
const ROUTE_EVENTS = ["beforeMatched", "matched", "patternMatched", "switched"];

type RoutingEvent = Event<Record<string, unknown>>;

/** Event parameters as plain data: UI5 objects become their ID (or class name), `config` is dropped. */
function plain(value: unknown): unknown {
	if (value instanceof ManagedObject) return value.getId();
	if (value instanceof BaseObject) return value.getMetadata().getName();
	if (typeof value === "function") return "function";
	if (Array.isArray(value)) return value.map(plain);
	if (value !== null && typeof value === "object") {
		return Object.fromEntries(
			Object.entries(value)
				.filter(([key]) => key !== "config")
				.map(([key, entry]) => [key, plain(entry)]),
		);
	}
	return value;
}

/** A router names its own class in its configuration and in what it logs. */
function nativeName(line: string): string {
	return line.replaceAll("ui5.guard.router.Router", "sap.m.routing.Router");
}

/** `<who> <event> <route name, hash or title> <parameters as JSON>` */
function describeEvent(who: string, event: RoutingEvent): string {
	const parameters = event.getParameters();
	const subject = parameters.name ?? parameters.hash ?? parameters.title ?? "";
	return nativeName(`${who} ${event.getId()} ${String(subject)} ${JSON.stringify(plain(parameters))}`);
}

/**
 * Record the routing events of `router`, the events of the routes in `routeNames` and the
 * targets its Targets instance displays, each line prefixed with `who`.
 */
export function recordRouter(who: string, router: Router, trace: string[], routeNames: string[] = []): void {
	const record = (event: RoutingEvent): void => {
		trace.push(describeEvent(who, event));
	};
	for (const eventId of ROUTER_EVENTS) {
		router.attachEvent(eventId, record);
	}
	for (const routeName of routeNames) {
		const route = router.getRoute(routeName);
		for (const eventId of ROUTE_EVENTS) {
			route?.attachEvent(eventId, (event: RoutingEvent) => {
				trace.push(describeEvent(`${who} route:${routeName}`, event));
			});
		}
	}
	router.getTargets()?.attachEvent("display", record);
}

/**
 * Record what the browser hash does: `hashSet` adds a history entry, `hashReplaced` does not,
 * `hashChanged` is the hash the browser reports. The pair set/replaced stands for the history
 * length, which the browser caps and which therefore cannot be compared between two runs.
 */
export function recordHashes(trace: string[]): () => void {
	const hashChanger = HashChanger.getInstance();
	const record = (event: RoutingEvent): void => {
		trace.push(describeEvent("hash", event));
	};
	const eventIds = ["hashSet", "hashReplaced", "hashChanged"];
	for (const eventId of eventIds) {
		hashChanger.attachEvent(eventId, record);
	}
	return () => {
		for (const eventId of eventIds) {
			hashChanger.detachEvent(eventId, record);
		}
	};
}

/**
 * Record every warning and error that UI5 or the library logs. The warning of a NavContainer
 * that is asked to navigate to its current page goes to `currentPageWarnings` instead: whether
 * UI5 logs it depends on how fast a view or component loads.
 */
export function recordLogs(trace: string[], currentPageWarnings: string[] = []): () => void {
	const level = Log.getLevel();
	if (level < Log.Level.WARNING) {
		Log.setLevel(Log.Level.WARNING);
	}
	const listener = {
		__implements__sap_base_Log_Listener: true,
		onLogEntry(entry: Entry): void {
			// A NavContainer logs this each time it renders before its first page arrives: how often
			// depends on how fast the views load.
			if (entry.message.includes("because this is the current page")) {
				currentPageWarnings.push(entry.message);
			} else if (entry.level <= Log.Level.WARNING && !entry.message.includes("page stack is empty")) {
				const severity = entry.level === Log.Level.WARNING ? "warning" : "error";
				trace.push(nativeName(`log ${severity} ${entry.message} (component: ${entry.component ?? ""})`));
			}
		},
	};
	Log.addLogListener(listener);
	return () => {
		Log.removeLogListener(listener);
		Log.setLevel(level);
	};
}

/** Resolve once the trace has stopped growing: every promise chain of the last action has run. */
export async function settle(trace: string[]): Promise<void> {
	const length = trace.length;
	await flushPromises();
	await flushPromises();
	await flushPromises();
	if (trace.length !== length) {
		return settle(trace);
	}
}

/**
 * Resolve once every line prefix in `expected` occurs in the trace from index `from` on.
 * A behavior that never happens fails the test with the trace instead of hanging it.
 */
export async function until(trace: string[], from: number, expected: string[], what: string): Promise<void> {
	const deadline = performance.now() + 4000;
	const missing = (): string[] =>
		expected.filter((prefix) => !trace.slice(from).some((line) => line.startsWith(prefix)));
	while (missing().length > 0) {
		if (performance.now() > deadline) {
			throw new Error(
				`${what}: never recorded ${JSON.stringify(missing())}. URL ${window.location.href} Trace:\n${trace.join("\n")}`,
			);
		}
		await flushPromises();
	}
}

/**
 * Where `actual` first differs from `expected`, with the lines before it; `undefined` when the
 * traces are equal. A whole trace is too long for a test report to show the difference.
 */
export function firstDifference(actual: string[], expected: string[]): string | undefined {
	const index = expected.findIndex((line, at) => line !== actual.at(at));
	const at = index === -1 && actual.length > expected.length ? expected.length : index;
	if (at === -1) {
		return undefined;
	}
	return [
		`line ${at} of ${expected.length} (actual has ${actual.length})`,
		...expected.slice(Math.max(0, at - 4), at).map((line) => `   ${line}`),
		`expected: ${expected.at(at) ?? "(end of trace)"}`,
		`actual:   ${actual.at(at) ?? "(end of trace)"}`,
		`then expected: ${expected.slice(at + 1, at + 4).join("\n               ")}`,
		`then actual:   ${actual.slice(at + 1, at + 4).join("\n               ")}`,
	].join("\n");
}
