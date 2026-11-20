<p align="center">
  <a href="https://www.npmjs.com/package/ui5-lib-guard-router"><img src="https://img.shields.io/npm/v/ui5-lib-guard-router.svg" alt="npm"></a>
  <a href="https://npmx.dev/package/ui5-lib-guard-router"><img src="https://img.shields.io/npm/v/ui5-lib-guard-router?label=npmx.dev&color=0a0a0a" alt="npmx"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-blue.svg" alt="License"></a>
  <a href="https://openui5.org/"><img src="https://img.shields.io/badge/OpenUI5-1.120%2B-green.svg" alt="UI5"></a>
  <a href="https://www.typescriptlang.org/"><img src="https://img.shields.io/badge/TypeScript-strict-blue.svg" alt="TypeScript"></a>
</p>

<h1 align="center">ui5-lib-guard-router</h1>

<p align="center">
Drop-in replacement for <code>sap.m.routing.Router</code> with async navigation guards. Guards run <b>before</b> route matching, target loading and view creation.
</p>

> Born from [UI5/openui5#3411](https://github.com/UI5/openui5/issues/3411), an open request since 2021 for native navigation guard support in UI5.

UI5's router cannot block or redirect a navigation before views render. Guard logic in `attachPatternMatched` callbacks flashes unauthorized content, pollutes the browser history and spreads the checks across controllers. This library extends `sap.m.routing.Router`: guards run in a `navTo()` preflight before the hash changes, and in `parse()` for back/forward and URL changes, before any route matches.

> [!CAUTION]
> Navigation guards are a UX layer only. Keep authorization, validation, and access control on the server.

> [!WARNING]
> This library is **experimental**. It is not battle-tested in production environments, and the API may change without notice. Pin your version and review changes before upgrading.

> [!IMPORTANT]
> **Supported UI5 versions: 1.120 and later**
>
> The package declares `minUI5Version: 1.120.0`. CI runs the full suite on 1.144, the library tests on 1.120 and the launchpad tests on SAPUI5 1.144 and 1.149. See [Compatibility](packages/lib/README.md#compatibility).

## Quick start

### 1. Install

```bash
npm install ui5-lib-guard-router
```

> [!NOTE]
> The npm package is ~280 KB compressed (~1.2 MB unpacked) because it ships both pre-built distributables and TypeScript sources. At runtime, the browser loads only the `library-preload.js` bundle (~36 KB, ~10 KB gzipped).

`ui5 serve` picks up the pre-built library through its UI5 build manifest. Other serving options and the TypeScript setup are in the library README, [Install](packages/lib/README.md#install).

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

All existing routes, targets, and navigation calls work unchanged.

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

Guards can also be declared in `manifest.json`. The API, manifest configuration, browser history, Fiori launchpad integration and limitations are in the **[library documentation](packages/lib/README.md)**.

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

Issues and pull requests are welcome. File an issue for a bug, a question or a proposal, or open a PR directly.

[CONTRIBUTING.md](CONTRIBUTING.md) has the development setup, the test commands, where tests go, the quality checks and the release process. [docs/README.md](docs/README.md) maps the longer docs.

## License

[MIT](LICENSE)
