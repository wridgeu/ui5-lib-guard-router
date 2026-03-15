# ui5-lib-guard-router Demo App

Demo application showcasing `ui5.guard.router.Router` with authentication-based navigation guards.

The demo supports both standalone preview and a local FLP sandbox preview served from a virtual endpoint.

## Routes

| Route       | Pattern       | Guard behavior                                                      |
| ----------- | ------------- | ------------------------------------------------------------------- |
| `home`      | `""`          | Open -- no guard                                                    |
| `protected` | `"protected"` | Enter: requires login (redirects to `home`). Leave: blocks if dirty |
| `forbidden` | `"forbidden"` | Always blocked -- redirects to `home`                               |

## Running

From the monorepo root:

```bash
npm start
npm run start:flp
```

Or from this directory:

```bash
npm start
# => opens http://localhost:8080/index.html

npm run start:flp
# => opens http://localhost:8080/test/flp.html#app-preview
```

The UI includes a few demo-only helpers to exercise hash-driven scenarios and FLP runtime visibility. They are isolated inside the demo app and are not part of the library contract for consumers.

## Scripts

```bash
# Start dev server with livereload and open the standalone app
npm start

# Start dev server with livereload and open the FLP sandbox preview
npm run start:flp

# Build
npm run build

# Type check
npm run typecheck
```

## E2E tests

From the monorepo root:

```bash
npm run test:e2e
```

The command starts and stops the demo server on port 8080 for you.

Test files are in `test/e2e/`:

| File                    | Coverage                                                       |
| ----------------------- | -------------------------------------------------------------- |
| `routing-basic.e2e.ts`  | Basic navigation, login flow, nav-back                         |
| `guard-allow.e2e.ts`    | Navigation allowed after login                                 |
| `guard-block.e2e.ts`    | Navigation blocked when logged out                             |
| `guard-redirect.e2e.ts` | Forbidden route redirects to Home                              |
| `nav-button.e2e.ts`     | UI5 Page nav-back button, re-navigation                        |
| `multi-route.e2e.ts`    | Multi-step sequences, mid-session logout                       |
| `browser-back.e2e.ts`   | Browser back/forward with guard state changes                  |
| `direct-url.e2e.ts`     | Direct URL entry, nonexistent routes, rapid hash changes       |
| `leave-guard.e2e.ts`    | Dirty form leave guard: allow clean, block dirty, browser back |

## Framework

- OpenUI5 1.144.0
- TypeScript via `ui5-tooling-transpile`
- `ui5-middleware-livereload` for dev server
- `fiori-tools-preview` for local FLP preview
- wdio v9 + wdi5 v3 for E2E tests
