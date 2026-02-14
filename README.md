<p align="center">
  <a href="https://www.npmjs.com/package/ui5-lib-guard-router"><img src="https://img.shields.io/npm/v/ui5-lib-guard-router.svg" alt="npm"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-blue.svg" alt="License"></a>
  <a href="https://openui5.org/"><img src="https://img.shields.io/badge/OpenUI5-1.144.0-green.svg" alt="UI5"></a>
  <a href="https://www.typescriptlang.org/"><img src="https://img.shields.io/badge/TypeScript-strict-blue.svg" alt="TypeScript"></a>
</p>

# ui5-lib-guard-router

UI5 Router extension with async navigation guards. Drop-in replacement for `sap.m.routing.Router` that intercepts navigation **before** route matching, target loading, or view creation, preventing unauthorized content flashes.

> Born from [SAP/openui5#3411](https://github.com/SAP/openui5/issues/3411), an open request since 2021 for native navigation guard support in UI5. Track the UI5 team's progress there.

UI5's native router has no way to block or redirect navigation before views are displayed. Developers resort to guard logic in `attachPatternMatched` callbacks, which causes **flashes of unauthorized content**, **pollutes browser history**, and **scatters guard logic** across controllers. This library solves all three by extending `sap.m.routing.Router` and overriding `parse()` — the single entry point for all navigation — so guards run before any route matching or view creation begins.

> [!WARNING]
> This library is **experimental**. It is not battle-tested in production environments, and the API may change without notice. If you choose to consume it, you do so at your own risk — make sure to pin your version and review changes before upgrading.

> [!IMPORTANT]
> **Minimum UI5 version: 1.118** — The library uses [`sap.ui.core.Lib`](https://sdk.openui5.org/api/sap.ui.core.Lib) for initialization (introduced in 1.118). Developed and tested against OpenUI5 1.144.0.

## Quick start

### 1. Install

```bash
npm install ui5-lib-guard-router
```

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
		const router = this.getRouter() as unknown as GuardRouter;

		// Route-specific guard — redirects to "home" when not logged in
		router.addRouteGuard("protected", (context) => {
			return isLoggedIn() ? true : "home";
		});

		// Global guard — runs for every navigation
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

For the full API reference, usage examples, limitations, and FLP integration guidance, see the **[library documentation](packages/lib/README.md)**.

## Repository structure

```
packages/
  lib/          ui5.guard.router library (Router + types)
  demo-app/     Demo app with auth guards (home, protected, forbidden routes)
docs/           Design research and feature proposals
```

## Development

### Prerequisites

- Node.js >= 22
- npm >= 9 (workspaces)

### Install and run

```bash
npm install       # install all dependencies
npm start         # demo app at http://localhost:8080/index.html
```

### Tests

```bash
npm test              # run all tests (QUnit + E2E, sequentially)
npm run test:qunit    # unit tests only
npm run test:e2e      # integration tests only
```

Each test command automatically starts and stops the appropriate server (port 8080).

### Quality checks

```bash
npm run typecheck    # TypeScript strict mode
npm run lint         # oxlint
npm run fmt:check    # oxfmt
npm run check        # all of the above
```

A pre-commit hook (husky + lint-staged) automatically runs `oxlint --fix` and `oxfmt` on staged files.

### Build

```bash
npm run build        # library → packages/lib/dist/
```

### Releases

Automated via [release-please](https://github.com/googleapis/release-please) and GitHub Actions.

1. Merge PRs with [Conventional Commits](https://www.conventionalcommits.org/) into `main` (e.g. `feat:`, `fix:`)
2. release-please opens/updates a "Release PR" that bumps versions and maintains `CHANGELOG.md`
3. Merging the Release PR triggers: build, test (QUnit + E2E), then `npm publish` with provenance via OIDC

| File                            | Purpose                                            |
| ------------------------------- | -------------------------------------------------- |
| `.github/workflows/ci.yml`      | CI pipeline (lint, format, typecheck, build, test) |
| `.github/workflows/release.yml` | Release-please + npm publish                       |
| `release-please-config.json`    | Package path, extra version files                  |
| `.release-please-manifest.json` | Current version tracker                            |

## License

[MIT](LICENSE)
