# ui5-lib-guard-router Demo App

Demo application showcasing `ui5.guard.router.Router` with authentication-based navigation guards.

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
```

Or from this directory:

```bash
npm start
# => opens http://localhost:8080/index.html
```

Toggle the login button on the Home page and try navigating to the Protected and Forbidden routes to see guards in action.

## Scripts

```bash
# Start dev server with livereload
npm start

# Build
npm run build

# Type check
npm run typecheck
```

## E2E tests

From the monorepo root (requires the demo-app server running on port 8080):

```bash
npm run test:e2e
```

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
- wdio v9 + wdi5 v3 for E2E tests
