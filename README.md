<p align="center">
  <a href="https://www.npmjs.com/package/ui5-lib-guard-router"><img src="https://img.shields.io/npm/v/ui5-lib-guard-router.svg" alt="npm"></a>
  <a href="https://npmx.dev/package/ui5-lib-guard-router"><img src="https://img.shields.io/npm/v/ui5-lib-guard-router?label=npmx.dev&color=0a0a0a" alt="npmx"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-blue.svg" alt="License"></a>
  <a href="https://openui5.org/"><img src="https://img.shields.io/badge/OpenUI5-1.144.0-green.svg" alt="UI5"></a>
  <a href="https://www.typescriptlang.org/"><img src="https://img.shields.io/badge/TypeScript-strict-blue.svg" alt="TypeScript"></a>
</p>

<h1 align="center">ui5-lib-guard-router</h1>

<p align="center">
UI5 Router extension with async navigation guards. Drop-in replacement for <code>sap.m.routing.Router</code> that intercepts navigation <b>before</b> route matching, target loading, or view creation, preventing unauthorized content flashes.
</p>

> Born from [UI5/openui5#3411](https://github.com/UI5/openui5/issues/3411), an open request since 2021 for native navigation guard support in UI5. Track the UI5 team's progress there.

UI5's native router has no way to block or redirect navigation before views are displayed. Developers resort to guard logic in `attachPatternMatched` callbacks, which causes **flashes of unauthorized content**, **pollutes browser history**, and **scatters guard logic** across controllers. This library solves all three by extending `sap.m.routing.Router`: guards run in a `navTo()` preflight before the hash changes, and in `parse()` for browser back/forward and URL changes, before any route matching or view creation begins.

> [!CAUTION]
> Navigation guards are a UX layer only. Keep authorization, validation, and access control on the server.

> [!WARNING]
> This library is **experimental**. It is not battle-tested in production environments, and the API may change without notice. If you choose to consume it, you do so at your own risk. Make sure to pin your version and review changes before upgrading.

> [!IMPORTANT]
> **Shipped UI5 baseline: 1.144.0**
>
> The published package declares `minUI5Version: 1.144.0`. The core router is also tested on OpenUI5 `1.120.0`. See [Compatibility](packages/lib/README.md#compatibility).

## Quick start

### 1. Install

```bash
npm install ui5-lib-guard-router
```

> [!NOTE]
> The npm package is ~190 KB compressed because it ships both pre-built distributables and TypeScript sources to support multiple consumption models (pre-built, transpile-from-source, static serving). At runtime, the browser loads only the `library-preload.js` bundle (~29 KB). See the [library README](packages/lib/README.md#serving-the-library) for details.

If your app uses TypeScript and does not already depend on the UI5 typings, install them too (`@sapui5/types` works as well):

```bash
npm install -D @openui5/types
```

TypeScript types follow the UI5 module names. Add the package to `compilerOptions.types`:

```json
{
	"compilerOptions": {
		"types": ["@openui5/types", "ui5-lib-guard-router"]
	}
}
```

Then import the types from the UI5 module path:

```typescript
import type { GuardRouter } from "ui5/guard/router/types";
```

UI5 runtime module names stay `ui5/guard/router/*`.

The package ships pre-built distributables with a [UI5 build manifest](https://github.com/SAP/ui5-tooling/blob/main/rfcs/0006-local-dependency-resolution.md), so `ui5 serve` picks them up automatically. See the [library README](packages/lib/README.md#serving-the-library) for alternative serving options (transpile from source, static middleware).

### 2. Configure manifest.json

Add the library dependency and set the router class:

```json
{
	"sap.ui5": {
		"dependencies": {
			"libs": {
				"ui5.guard.router": {}
			}
		},
		"routing": {
			"config": {
				"routerClass": "ui5.guard.router.Router"
			}
		}
	}
}
```

### 3. Register guards

```typescript
import UIComponent from "sap/ui/core/UIComponent";
import type { GuardRouter } from "ui5/guard/router/types";

export default class Component extends UIComponent {
	static metadata = {
		manifest: "json",
		interfaces: ["sap.ui.core.IAsyncContentCreation"],
	};

	init(): void {
		super.init();
		const router = this.getRouter() as GuardRouter;

		// Route-specific guard: redirects to "home" when not logged in
		router.addRouteGuard("protected", (context) => {
			return isLoggedIn() ? true : "home";
		});

		// Global guard: runs for every navigation
		router.addGuard((context) => {
			if (context.toRoute === "admin" && !isAdmin()) {
				return "home";
			}
			return true;
		});

		router.initialize();
	}
}
```

That's it. All existing routes, targets, and navigation calls continue to work unchanged.

If a non-empty initial hash is blocked on first load, the router restores `""` and continues with the app's default route. If the default route itself is blocked, it stays blocked. For a specific denied-first-load destination such as `login`, return a redirect instead of `false`.

For the full API reference, usage examples, limitations, and FLP integration guidance, see the **[library documentation](packages/lib/README.md)**.

## Repository structure

```
CONTRIBUTING.md Development setup, tests, quality checks, releases
docs/           Docs index plus guides, reference, feature notes, explorations, research
packages/
  lib/          ui5.guard.router library (Router + types) and its QUnit tests
  demo-app/     Demo app with auth guards, a nested component, FLP preview, and guided scenarios
scripts/        CI helpers, layout check, pack smoke test, release plan, and vendored parity tooling
tools/          Custom oxlint JS plugins (code-quality, comment-quality, test-guardrails), Chrome profile hooks of the wdio configs
```

## Contributing

Issues and pull requests are always welcome. If you spot a bug, have a question, or want to propose an improvement, please file an issue. If you already have a fix or documentation update in mind, feel free to open a PR directly.

[CONTRIBUTING.md](CONTRIBUTING.md) has the development setup, the test commands, where tests go, the quality checks and the release process. [docs/README.md](docs/README.md) maps the longer docs.

## License

[MIT](LICENSE)
