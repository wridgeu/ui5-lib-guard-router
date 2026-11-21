# Patches

[`patch-package`](https://github.com/ds300/patch-package) applies the `*.patch` files in this folder after every `npm install` and `npm ci` (the `postinstall` script of the root `package.json`). Each patch fixes a bug in a dependency that has no fixed release yet. It is named after the version it was made for. After an update of that dependency, `patch-package` warns about the version mismatch and still applies the patch if it fits. If the patch no longer fits, it fails the install in CI and only prints an error locally.

## `ui5-tooling-transpile+3.14.1.patch`

**What breaks without it:** the type declarations the library publishes (`dist/resources/ui5/guard/router/*.d.ts`) do not type-check for consumers.

`ui5-tooling-transpile` generates the `.d.ts` files during `ui5 build`. It wraps each module in an ambient module declaration named after its full UI5 module name, and rewrites the relative imports in it to full module names, because a relative import is not allowed inside `declare module "..." { }`. It finds the imports with this regex (`lib/task.js`):

```js
/import.+("\.{1,2}[^"]+"|'\.{1,2}[^']+')/g;
```

`.` does not match a line break, so the regex finds only imports written on one line. oxfmt breaks an import onto several lines once it is longer than the print width. In `packages/lib/src/GuardConfig.ts`, adding `GuardRouterLogLevel` (1.7.0) did that:

```ts
import type {
	GuardLoading,
	GuardRouterLogLevel,
	Inheritance,
	NavToPreflightMode,
	UnknownRouteRegistrationPolicy,
} from "./types";
```

Unpatched, the generated `GuardConfig.d.ts` keeps the relative path:

```ts
declare module "ui5/guard/router/GuardConfig" {
    import type { GuardLoading, GuardRouterLogLevel, ... } from "./types";
```

and type-checking it in a consumer project fails:

```text
GuardConfig.d.ts(2,5): error TS2439: Import or export declaration in an ambient module declaration cannot reference module through relative module name.
GuardConfig.d.ts(2,125): error TS2307: Cannot find module './types' or its corresponding type declarations.
```

`npm run pack:check` catches this: `scripts/pack-smoke.mjs` installs the packed tarball in a temporary project and runs `tsc` against it. Before the patch, `Router.ts` avoided the bug by importing from `"ui5/guard/router/types"` instead of `"./types"`.

**The fix:** the patch matches from `import` to the closing quote of the module path, across line breaks but not past the end of the statement:

```diff
-const relativeModulePaths = [...source.matchAll(/import.+("\.{1,2}[^"]+"|'\.{1,2}[^']+')/g)];
+const relativeModulePaths = [...source.matchAll(/\bimport\b[^;]*?("\.{1,2}[^"]+"|'\.{1,2}[^']+')/g)];
```

The generated declaration then reads `from "ui5/guard/router/types"`, as it does for a one-line import.

**When to remove it:** once a `ui5-tooling-transpile` release matches multi-line imports. Delete the patch, update the dependency, and run `npm run pack:check`; it must pass with the multi-line import in `GuardConfig.ts` unchanged.

## Changing a patch

Edit the file in `node_modules/<package>/`, then run `npx patch-package <package>` from the repository root. It rewrites the `.patch` file from the difference to the published package.
