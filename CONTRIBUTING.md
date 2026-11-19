# Contributing

Issues and pull requests are always welcome. If you spot a bug, have a question, or want to propose an improvement, please file an issue. If you already have a fix or documentation update in mind, feel free to open a PR directly.

The docs are mapped in [docs/README.md](docs/README.md); the architecture, including the test architecture, is in [docs/reference/architecture.md](docs/reference/architecture.md).

## Prerequisites

- Node.js ^24.22.1 or >= 26.12.1
- npm >= 9 (workspaces)

## Install and run

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

## Tests

```bash
npm test              # run the default local subset (QUnit + standalone E2E)
npm run test:full     # run the full browser matrix (default + compat + FLP on both SAPUI5 versions)
npm run test:qunit    # unit tests only (includes vendored upstream parity)
npm run test:qunit:compat:120 # core library QUnit suite on OpenUI5 1.120.0
npm run test:e2e      # integration tests only
npm run test:e2e:flp  # FLP preview smoke tests (shell + dirty-state integration)
npm run test:e2e:flp:149 # the same FLP tests on SAPUI5 1.149.0 (`ui5 serve --framework-version`, no second config)
npm run test:mutation # Stryker mutation testing of packages/lib, one file at a time (slow; reports in reports/mutation/<File>.html)
```

Each test command automatically starts and stops its own server. The suites use dedicated test ports so standalone, compatibility, and FLP lanes can run side by side without colliding.

`test:mutation` runs Stryker once per source file, each against a fresh server. Pass files or line ranges to narrow it: `npm run test:mutation -- packages/lib/src/Router.ts:200-400`. Results are kept per file in `reports/mutation/incremental/`, so a repeated run only tests new or changed mutants; any change under `packages/lib/test/` discards them, and `--force` discards them on demand. Stryker edits the sources in place: if a run is interrupted, copy the files from `.stryker-tmp/backup-*/` back over `packages/lib/src` and delete `.stryker-tmp` (the script refuses to start until you do).

### Test conventions

- The QUnit tests never wait on time; the `test-guardrails/no-timers` lint rule rejects `setTimeout` and `setInterval` in `packages/lib/test/qunit/`. Tests wait on router events (`waitForRoute()`, `navigationSettled()`), resolve test-controlled guard Promises (`Promise.withResolvers()`) at the point they need, and call `flushPromises()` before asserting that a superseded result had no effect. A test that waits for an event that never comes fails at the QUnit `testTimeout` in `testsuite.qunit.ts`.
- Tests pass values the types forbid (as an untyped JavaScript caller could) through the helpers in `packages/lib/test/qunit/testHelpers.ts` (`callUnsafe()`, the `*Unsafe` wrappers, `createRouterUnsafe()`) instead of casting.
- The few tests that inspect internal state read them with `Reflect.get()`, e.g. `Reflect.get(router, "_oConfig")`. The library uses TypeScript `private` rather than `#private` fields because UI5's class system relies on prototype-based inheritance and metadata introspection.

The vendored parity sources themselves are maintained with:

```bash
npm run vendor:openui5-router-tests -- --tag 1.144.0 --write-manifest
npm run verify:openui5-router-vendor
```

## Where tests go

QUnit tests of the library are below `packages/lib/test/qunit/`. A folder is one test page; `testsuite.qunit.ts` lists the files of each page, and `npm run check:layout` fails for a test file that is on no page.

| What the test is about                                    | Where it goes                                                                                                       |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| Logic of one source module, without a router (`src/X.ts`) | `unit/X.qunit.ts`; split by topic into `unit/X<Topic>.qunit.ts` before the file reaches 800 lines                   |
| Behavior of a router instance                             | `router/<area>/<Topic>.qunit.ts`. Add a new area (a folder and one entry in `testsuite.qunit.ts`) only if none fits |
| Comparison with the native `sap.m.routing.Router`         | `parity/`                                                                                                           |
| Upstream OpenUI5 tests                                    | `upstream-parity/`, only through `npm run vendor:openui5-router-tests`                                              |
| The demo app in a browser                                 | `packages/demo-app/test/e2e/`, one spec file per scenario area                                                      |
| The demo app in the Fiori launchpad preview               | `packages/demo-app/test/flp/`                                                                                       |
| The demo app in an iframe of the launchpad                | `packages/demo-app/test/flp/`, on the launchpad page of `test/flp/iframe/webapp/` (served at `/iframe`)             |
| A lint plugin in `tools/` or a script in `scripts/`       | `<name>.test.mjs` next to it, run by `npm run test:tooling` (`node --test`)                                         |

Rules that keep the layout working:

- **Browser history steps** (`history.back()`, `forward()`, `go()`) belong only in the pages that run alone: `router/history`, `parity/nested`, `parity/guarded`, `parity/entries`, `parity/steps`. Chrome ignores a history step on a page that changed the hash about 200 times within ten seconds, so a history test on a busy page fails. `parity/guarded`, `parity/entries` and `parity/steps` also record what the browser does with its history entries and have to stay below that number, so a new test of that kind may need a page of its own.
- **QUnit module names** are `"<Area> - <topic>"`, unique, and never shared by two files: a failing test is found by its module name.
- **Helpers**: used by one file, they stay in the file; by one folder, in `<folder>/<folder>Helpers.ts`; by several folders, in `testHelpers.ts`; by the sub-pages of one parent folder, in that parent folder (`parity/parityRecorder.ts`, `parity/nestedParityHarness.ts`). A module with tests that share one router gets its hooks from `routerHooks()`.
- **Fixtures** are in `fixtures/<kind>/`; the `sap.app.id` of a fixture component matches its folder path.
- **Demo specs that need a browser session of their own** (a page load with other URL parameters, another launchpad page, a resource that fails to load) are a spec file of their own with "(isolated session)" in the `describe` title: wdio starts a session per spec file.
- **Demo tests**: selectors and model access shared by the standalone and the FLP suite are in `packages/demo-app/test/shared/`. Code that runs in the browser through `browser.execute()` reads UI5 modules with `sap.ui.require(name)`; `packages/demo-app/test/browser-modules.ts` declares the type of each module read that way.
- A test that the docs cite by file and title (the "Proven by" column of the compatibility table in the library README) is renamed or moved together with its citation; `npm run check:layout` fails for a citation that names no test.

## Quality checks

```bash
npm run typecheck    # tsc, strict: lib and demo tsconfigs, and tsconfig.node.json (scripts/, tools/ with checkJs, wdio configs)
npm run lint         # oxlint, type-aware through oxlint-tsgolint; the no-unsafe-* rules apply everywhere except the vendored ports and the FLP JS fixtures; the tests and the demo webapp may cast (no-unsafe-type-assertion)
npm run fmt:check    # oxfmt
npm run check:layout # test files on a page, unique module names, test paths and citations in the docs
npm run check:diagrams # every Mermaid block in the docs parses and has no backtick (GitHub prints it); a call name() or a private _name in a label exists in the code of packages/lib/src, comments aside, or is listed as external in the script; mermaid is pinned to 12.3.0, the version GitHub renders with
npm run test:tooling # node --test for the lint plugins in tools/ and the scripts in scripts/ (*.test.mjs)
npm run check        # all of the above (fmt:check + lint + typecheck + check:layout + check:diagrams + test:tooling)
npm run fmt          # auto-format all files
npm run lint:fix     # auto-fix lint issues
npm run pack:smoke   # install the packed library in a temp consumer and typecheck it
npm run pack:check   # build + dry-run pack + consumer smoke test
npm run release:plan # preview the next release-please version/PR locally
npm run commitlint   # validate the latest commit message locally
```

The local hooks run `oxlint --fix` and `oxfmt` on staged files, and `commitlint` validates Conventional Commit messages locally and in CI.

Linting also includes a few repo-local custom oxlint JS plugins from `tools/`, so some rule names and diagnostics differ from upstream oxlint.

### Diagram style

Every Mermaid diagram uses this palette; `check:diagrams` rejects a `classDef` that differs from it. The colours are readable in the light and the dark theme of GitHub.

| Class      | Meaning                                 | `classDef`                                                       |
| ---------- | --------------------------------------- | ---------------------------------------------------------------- |
| `native`   | Native UI5, or nothing the library does | `fill:#6e7781,stroke:#424a53,color:#ffffff`                      |
| `added`    | What the library adds                   | `fill:#0969da,stroke:#54aeff,stroke-width:3px,color:#ffffff`     |
| `optional` | Optional surroundings                   | `fill:#afb8c1,stroke:#6e7781,stroke-dasharray:5 4,color:#1f2328` |
| `decision` | A decision                              | `fill:#ddf4ff,stroke:#0969da,color:#1f2328`                      |
| `commit`   | Outcome commit                          | `fill:#1a7f37,stroke:#4ac26b,stroke-width:3px,color:#ffffff`     |
| `redirect` | Outcome redirect                        | `fill:#9a6700,stroke:#d4a72c,stroke-width:3px,color:#ffffff`     |
| `block`    | Outcome block                           | `fill:#cf222e,stroke:#ff8182,stroke-width:3px,color:#ffffff`     |
| `error`    | Outcome error                           | `fill:#82071e,stroke:#ff8182,stroke-width:3px,color:#ffffff`     |

- A flowchart or state diagram that uses the classes has a legend, in the figure or as one line under it.
- A sequence diagram puts the library's participants in `box rgba(9, 105, 218, 0.15) This library` and those of UI5 or the launchpad in `box rgba(110, 119, 129, 0.2)`. A diagram of one outcome wraps its messages in a `rect`: `rgba(26, 127, 55, 0.15)` committed, `rgba(154, 103, 0, 0.2)` redirected, `rgba(207, 34, 46, 0.15)` blocked.
- One diagram per case, no wider than three participants: GitHub measures a figure once and cuts it off at the bottom when the column grows afterwards, so a figure must fit the column without being scaled (about 720px).
- No backtick in a label, and `#35;` for a `#` in a sequence diagram: Mermaid drops the rest of the line after a `#`.

## Build

```bash
npm run build        # library → packages/lib/dist/
npm run clean        # remove dist and .ui5 caches in all packages
```

## Releases

Automated via [release-please](https://github.com/googleapis/release-please) and GitHub Actions.

1. Merge PRs with [Conventional Commits](https://www.conventionalcommits.org/) into `main` (for example `feat:` or `fix:`)
2. release-please opens/updates a "Release PR" that bumps versions and maintains `packages/lib/CHANGELOG.md`
3. Pushing to `main` runs the full reusable CI workflow first (format, lint, typecheck, diagram and tooling checks, pack checks, vendored parity verification, browser tests, OpenUI5 1.120 compatibility, FLP on SAPUI5 1.149, and Windows smoke); if release-please creates a release, the publish job then builds `packages/lib` and runs `npm publish` with provenance via OIDC

For a local preview of what release-please would do next, run `npm run release:plan`. It wraps the official `release-please release-pr --dry-run` CLI, prefers `RELEASE_PLEASE_TOKEN`, `GITHUB_TOKEN`, or `GH_TOKEN` when set, and otherwise falls back to `gh auth token` when the GitHub CLI is available.

Short maintainer conventions:

- Use `[skip ci]` only for docs-only or issue-only commits that do not affect shipped code, tests, or build/release configuration.
- Do not use `[skip ci]` for library code, demo app code, tests, tooling, workflow, or release-related changes.
- Do not bump versions manually in package manifests or release files; release-please is the source of truth for versioning and release commits.
- If the shipped UI5 baseline changes, update all baseline touchpoints together: `README.md`, `packages/lib/README.md`, `packages/demo-app/README.md`, `packages/lib/src/manifest.json`, `packages/lib/ui5.yaml`, `packages/demo-app/ui5.yaml` and `packages/demo-app/ui5-flp.yaml`. The UI5 type packages in the root `package.json` only need to be at least the baseline.
  Also update the vendored parity lane: `npm run vendor:openui5-router-tests -- --tag <new-version> --write-manifest`, then migrate the versioned port directory.
- For UI5 baseline or release-affecting changes, run the full validation matrix from the repo root: `npm run check`, `npm run test:full`, and `npm run pack:check`.

| File                            | Purpose                                                                                                                                                                        |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `.github/workflows/ci.yml`      | Reusable CI pipeline (format, lint, typecheck, diagram and tooling checks, pack checks, parity verification, browser tests, compatibility, FLP on SAPUI5 1.149, Windows smoke) |
| `.github/workflows/release.yml` | Release-please + npm publish                                                                                                                                                   |
| `release-please-config.json`    | Package path, extra version files                                                                                                                                              |
| `.release-please-manifest.json` | Current version tracker                                                                                                                                                        |
