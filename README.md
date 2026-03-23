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

> Born from [SAP/openui5#3411](https://github.com/SAP/openui5/issues/3411), an open request since 2021 for native navigation guard support in UI5. Track the UI5 team's progress there.

UI5's native router has no way to block or redirect navigation before views are displayed. Developers resort to guard logic in `attachPatternMatched` callbacks, which causes **flashes of unauthorized content**, **pollutes browser history**, and **scatters guard logic** across controllers. This library solves all three by extending `sap.m.routing.Router` and overriding `parse()`, the single entry point for all navigation, so guards run before any route matching or view creation begins.

> [!CAUTION]
> Navigation guards are a UX layer only. Keep authorization, validation, and access control on the server.

> [!WARNING]
> This library is **experimental**. It is not battle-tested in production environments, and the API may change without notice. If you choose to consume it, you do so at your own risk. Make sure to pin your version and review changes before upgrading.

> [!IMPORTANT]
> **Shipped UI5 baseline: 1.144.0**
>
> The published package declares `minUI5Version: 1.144.0`, and the full CI suite runs on that shipped baseline. In addition, CI runs the library QUnit suite against OpenUI5 `1.120.0` as a compatibility lane for the core router implementation. The compatibility baseline is 1.120 because `DataType.registerEnum` (used for the `NavigationOutcome` enum) requires that version. The shipped baseline also carries a dedicated vendored OpenUI5 router parity lane, which compares selected upstream `sap.m.routing.Router` behaviors against `ui5.guard.router.Router` when no guards are active.

## Quick start

### 1. Install

```bash
npm install ui5-lib-guard-router
```

> [!NOTE]
> The npm package is ~150 KB compressed because it ships both pre-built distributables and TypeScript sources to support multiple consumption models (pre-built, transpile-from-source, static serving). At runtime, the browser loads only the `library-preload.js` bundle (~25 KB). See the [library README](packages/lib/README.md#serving-the-library) for details.

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
docs/           Docs index plus reference, research, explorations, and feature notes
packages/
  lib/          ui5.guard.router library (Router + types)
  demo-app/     Demo app with auth guards, FLP preview, and guided scenarios
scripts/        CI helpers, pack smoke test, release plan, and vendored parity tooling
tools/          Custom oxlint JS plugins (code-quality, comment-quality, test-guardrails)
```

## Development

### Prerequisites

- Node.js >= 22
- npm >= 9 (workspaces)

### Install and run

```bash
npm install       # install all dependencies
npm start         # demo app at http://localhost:8080/index.html
npm run start:flp # demo app in local FLP preview at http://localhost:8080/test/flp.html#app-preview
```

Additional local servers:

```bash
npm run start:lib            # serve the library workspace directly
npm run start:lib:compat:120 # serve the library against OpenUI5 1.120.0
npm run serve:demo           # serve the demo app without auto-opening a browser
npm run serve:demo:flp       # serve the FLP preview without auto-opening a browser
```

### Tests

```bash
npm test              # run the default local subset (QUnit + standalone E2E)
npm run test:full     # run the full browser matrix (default + compat + FLP)
npm run test:qunit    # unit tests only (includes vendored upstream parity)
npm run test:qunit:compat:120 # core library QUnit suite on OpenUI5 1.120.0
npm run test:e2e      # integration tests only
npm run test:e2e:flp  # FLP preview smoke tests (shell + dirty-state integration)
```

Each test command automatically starts and stops its own server. The suites use dedicated test ports so standalone, compatibility, and FLP lanes can run side by side without colliding.

The vendored parity sources themselves are maintained with:

```bash
npm run vendor:openui5-router-tests -- --tag 1.144.0 --write-manifest
npm run verify:openui5-router-vendor
```

### Quality checks

```bash
npm run typecheck    # TypeScript strict mode
npm run lint         # oxlint
npm run fmt:check    # oxfmt
npm run check        # all of the above (fmt:check + lint + typecheck)
npm run fmt          # auto-format all files
npm run lint:fix     # auto-fix lint issues
npm run pack:smoke   # install the packed library in a temp consumer and typecheck it
npm run pack:check   # build + dry-run pack + consumer smoke test
npm run release:plan # preview the next release-please version/PR locally
npm run commitlint   # validate the latest commit message locally
```

The local hooks run `oxlint --fix` and `oxfmt` on staged files, and `commitlint` validates Conventional Commit messages locally and in CI.

Linting also includes a few repo-local custom oxlint JS plugins from `tools/`, so some rule names and diagnostics differ from upstream oxlint.

### Build

```bash
npm run build        # library → packages/lib/dist/
npm run clean        # remove dist and .ui5 caches in all packages
```

### Releases

Automated via [release-please](https://github.com/googleapis/release-please) and GitHub Actions.

1. Merge PRs with [Conventional Commits](https://www.conventionalcommits.org/) into `main` (for example `feat:` or `fix:`)
2. release-please opens/updates a "Release PR" that bumps versions and maintains `packages/lib/CHANGELOG.md`
3. Pushing to `main` runs the full reusable CI workflow first (format, lint, typecheck, pack checks, vendored parity verification, browser tests, OpenUI5 1.120 compatibility, and Windows smoke); if release-please creates a release, the publish job then builds `packages/lib` and runs `npm publish` with provenance via OIDC

For a local preview of what release-please would do next, run `npm run release:plan`. It wraps the official `release-please release-pr --dry-run` CLI, prefers `RELEASE_PLEASE_TOKEN`, `GITHUB_TOKEN`, or `GH_TOKEN` when set, and otherwise falls back to `gh auth token` when the GitHub CLI is available.

Short maintainer conventions:

- Use `[skip ci]` only for docs-only or issue-only commits that do not affect shipped code, tests, or build/release configuration.
- Do not use `[skip ci]` for library code, demo app code, tests, tooling, workflow, or release-related changes.
- Do not bump versions manually in package manifests or release files; release-please is the source of truth for versioning and release commits.
- If the shipped UI5 baseline changes, update all baseline touchpoints together: `README.md`, `packages/lib/src/manifest.json`, `packages/lib/ui5.yaml`, `packages/demo-app/ui5.yaml`, `packages/demo-app/ui5-flp.yaml`, and the root UI5 type-package versions in `package.json`.
  Also update the vendored parity lane: `npm run vendor:openui5-router-tests -- --tag <new-version> --write-manifest`, then migrate the versioned port directory.
- For UI5 baseline or release-affecting changes, run the full validation matrix from the repo root: `npm run check`, `npm run test:full`, and `npm run pack:check`.

| File                            | Purpose                                                                                                                       |
| ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `.github/workflows/ci.yml`      | Reusable CI pipeline (format, lint, typecheck, pack checks, parity verification, browser tests, compatibility, Windows smoke) |
| `.github/workflows/release.yml` | Release-please + npm publish                                                                                                  |
| `release-please-config.json`    | Package path, extra version files                                                                                             |
| `.release-please-manifest.json` | Current version tracker                                                                                                       |

## Contributing

Issues and pull requests are always welcome. If you spot a bug, have a question, or want to propose an improvement, please file an issue. If you already have a fix or documentation update in mind, feel free to open a PR directly.

## License

[MIT](LICENSE)
