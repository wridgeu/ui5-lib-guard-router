/**
 * Route metadata: manifest and runtime values per route, resolved with
 * optional pattern-tree inheritance and cached until something changes.
 */
import { isPatternAncestor, patternSegments, type RoutePattern } from "./PatternTree";

type Meta = Readonly<Record<string, unknown>>;

export const EMPTY_META: Meta = Object.freeze({});

export default class RouteMetaStore {
	private readonly _manifest: Map<string, Meta>;
	private readonly _runtime = new Map<string, Meta>();
	private readonly _resolved = new Map<string, Meta>();
	private readonly _routes: (() => RoutePattern[]) | null;

	/**
	 * @param manifest - Frozen metadata per route from the manifest `routeMeta` block.
	 * @param routes - Route patterns for pattern-tree inheritance, or `null` for none.
	 */
	constructor(manifest: Map<string, Meta>, routes: (() => RoutePattern[]) | null) {
		this._manifest = manifest;
		this._routes = routes;
	}

	/** Resolved metadata for a route: frozen, and the same object until something changes. */
	get(routeName: string): Meta {
		let result = this._resolved.get(routeName);
		if (result === undefined) {
			result = this._routes ? this._resolveInherited(routeName, this._routes()) : this._resolveOwn(routeName);
			if (Object.keys(result).length === 0) result = EMPTY_META;
			this._resolved.set(routeName, result);
		}
		return result;
	}

	/** Set runtime metadata for a route, merged over its manifest metadata. */
	set(routeName: string, meta: Record<string, unknown>): void {
		this._runtime.set(routeName, Object.freeze({ ...meta }));
		this._resolved.clear();
	}

	/** Drop resolved values, e.g. after a route was added that changes inheritance. */
	invalidate(): void {
		this._resolved.clear();
	}

	/** Drop all metadata, manifest and runtime. */
	clear(): void {
		this._manifest.clear();
		this._runtime.clear();
		this._resolved.clear();
	}

	/** Manifest metadata with runtime metadata on top, without inheritance. */
	private _resolveOwn(routeName: string): Meta {
		const manifest = this._manifest.get(routeName);
		const runtime = this._runtime.get(routeName);
		if (!runtime) return manifest ?? EMPTY_META;
		if (!manifest) return runtime;
		return Object.freeze({ ...manifest, ...runtime });
	}

	/** Ancestors' metadata shallowest-first, then the route's own; each level manifest then runtime. */
	private _resolveInherited(routeName: string, routes: RoutePattern[]): Meta {
		const own = routes.find((r) => r.name === routeName);
		if (!own) return this._resolveOwn(routeName);

		const levels = routes
			// Only the empty pattern counts as its own ancestor; merging a level twice changes nothing.
			.filter((r) => isPatternAncestor(r.pattern, own.pattern))
			.toSorted((a, b) => patternSegments(a.pattern).length - patternSegments(b.pattern).length)
			.map((r) => r.name);
		levels.push(routeName);

		const merged: Record<string, unknown> = {};
		for (const name of levels) {
			Object.assign(merged, this._manifest.get(name), this._runtime.get(name));
		}
		return Object.freeze(merged);
	}
}
