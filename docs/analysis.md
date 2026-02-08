# Analysis: UI5 Navigation Guard Problem & This Repository's Solution

## 1. The Problem

UI5's native router (`sap.m.routing.Router` / `sap.ui.core.routing.Router`) has **no mechanism to intercept, guard, or cancel navigation before route matching and target display**. This is a long-standing gap that has been discussed across multiple GitHub issues and community forums since at least 2017.

### 1.1 Key GitHub Issues

#### SAP/openui5#3411 — "How to interrupt / override the ongoing routing?" (OPEN since Dec 2021)

- **Reporter**: @pubmikeb (OpenUI5 1.98.0)
- **Core scenario**: User clicks a sidebar item to navigate from view A to view B, but permissions should redirect them to view C instead. The user should **never see** view B.
- **Attempted approaches that failed**:
    1. `attachRoutePatternMatched` — view B flashes for a second before redirect
    2. `attachBeforeRouteMatched` — same flash problem
    3. `router.stop()` + `router.initialize(true)` — still navigates to B
    4. HashChanger manipulation — doesn't help
    5. `sap.m.library.URLHelper.redirect()` — works but forces a full page reload (performance hit)

- **UI5 team response** (@flovogt, SAP Member):
    - Acknowledged the problem: _"interrupting the routing process is currently not easy for applications"_
    - Proposed a **future concept** with `preventDefault()` on `attachBeforeRouteMatched`:
        ```js
        checkAccess: function(oEvent) {
            if (!this.hasAccess()) {
                oEvent.preventDefault();
            }
        }
        ```
    - But identified a **critical blocker**: this would need to be **synchronous only**. Async backend calls for permission checks wouldn't work because the response arrives after the navigation has already completed.
    - Created internal backlog item **CPOUI5FRAMEWORK-338** (Jan 2022)
    - As of Jan 2024: _"stopping the ongoing navigation process is not implemented so far"_
    - As of Oct 2024: Still no progress. The UI5 team is focused on framework modernization and wants any future solution to be async-first.

- **Community pain points** (from issue comments):
    - @PlamenNonchev (Oct 2024): _"I couldn't find an 'out-of-the-box' way to achieve [an AuthGuard] in UI5"_
    - @wridgeu (Oct 2024): _"Would be awesome to build this into the router... Many ideas, not enough time to evaluate them all"_
    - Suggestion from @wridgeu to extend Router and override `parse` method (referencing [SO answer](https://stackoverflow.com/a/29167292))

#### SAP/openui5#3094 — "Prevent showing the UI5 app internal page without successful authentication" (CLOSED)

- **Core scenario**: Client-side navigation can be manipulated via DevTools to bypass authentication checks
- **SAP response** (@matz3): _"You can't fully prevent a user from manipulating code that runs on the client-side"_. Recommended server-side authorization and separate components for public/authenticated content.
- **Key takeaway**: Client-side guards are UX measures, not security measures. Server-side authorization is still required.

#### SAP/openui5#1326 — "Protect a route path" (CLOSED, 2017)

- Earliest documented request for route-level guards in UI5
- SAP's response: use `attachPatternMatched` — which is the "flash of unauthorized content" pattern

#### wridgeu/ui5-poc-ewm-one-login#1 — "Prevent browser back navigation to not logged in screen"

- **Scenario**: After login, browser back button returns to "not logged in" screen despite still being authenticated
- **Root cause**: `navTo()` creates browser history entries, allowing users to navigate "back" to invalid states
- **Proposed solutions**: Conditional rendering (no routes for login state), `navTo` with `bReplace: true`, custom Router extension, composable guard helper, component-registration API
- **Connection to this repo**: Directly motivated the development of `ui5.ext.routing`

### 1.2 The Core Problem Summarized

| Problem                                        | Impact                                                                       |
| ---------------------------------------------- | ---------------------------------------------------------------------------- |
| No pre-navigation interception                 | Views load before guard logic can run                                        |
| Flash of unauthorized content                  | Users briefly see protected pages before redirect                            |
| `beforeRouteMatched` has no `preventDefault()` | Event fires too late, can't cancel                                           |
| History pollution                              | `navTo()` always creates history entries; back button reaches invalid states |
| Scattered guard logic                          | Guards duplicated across every controller's `onInit`/`attachPatternMatched`  |
| No async guard support                         | UI5's event system is synchronous; can't check backend permissions           |
| No centralized guard registry                  | No single place to define "route X requires condition Y"                     |

### 1.3 The Deadlock

The UI5 team wants to implement this natively but faces a dilemma:

- Their current event system is synchronous
- A synchronous-only guard solution would prevent async permission checks
- Making it async requires fundamental framework changes
- The framework modernization effort takes priority
- **Result: 4+ years with no native solution** (CPOUI5FRAMEWORK-338 remains on the backburner)

---

## 2. How This Repository Solves It

### 2.1 The Key Insight: Override `parse()`

Every navigation path in UI5 flows through a single method: `parse(sNewHash)`.

```
User clicks link      →  navTo()      →  hashChanged  →  parse()
Browser back/forward  →                  hashChanged  →  parse()
Direct URL entry      →                  hashChanged  →  parse()
```

By overriding `parse()`, we intercept **all** navigation at the earliest possible point — before route matching, target loading, view creation, or event firing.

### 2.2 Architecture Overview

```
                    ┌─────────────────────────────────────┐
                    │           parse(newHash)             │
                    │  ┌─────────────────────────────────┐ │
                    │  │ _suppressNextParse?  → return   │ │
                    │  │ _redirecting?        → commit   │ │
                    │  │ same hash?           → return   │ │
                    │  │                                 │ │
                    │  │ Resolve route from hash         │ │
                    │  │ Build GuardContext               │ │
                    │  │                                 │ │
                    │  │ Run global guards (ordered)     │ │
                    │  │ Run route guards (ordered)      │ │
                    │  │                                 │ │
                    │  │ true  → _commitNavigation()     │ │
                    │  │ false → _restoreHash()          │ │
                    │  │ string/redirect → navTo(replace)│ │
                    │  └─────────────────────────────────┘ │
                    └─────────────────────────────────────┘
```

### 2.3 Design Decisions

| Decision                                  | Rationale                                                                                                                     |
| ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Override `parse()` not `navTo()`          | `navTo()` doesn't catch browser back/forward or direct URL changes                                                            |
| Synchronous-first pipeline                | When all guards return plain values, navigation completes in the same tick as the hash change. No flash, no framework desync. |
| Async fallback with generation counter    | Async guards are supported but deferred. A monotonic counter prevents stale results from overlapping navigations.             |
| `_redirecting` flag bypasses guards       | Prevents infinite loops when a guard redirects to another guarded route                                                       |
| `_suppressNextParse` for hash restoration | `replaceHash()` fires `hashChanged` synchronously; the flag prevents double-processing                                        |
| Strict `true` for allow                   | Only `=== true` allows navigation. Truthy values like `1`, `"yes"`, `{}` are treated as blocks to prevent accidental allows.  |
| `.extend()` pattern, not ES6 class        | Required for UI5 class registry — enables `"routerClass": "ui5.ext.routing.Router"` in manifest.json                          |

### 2.4 Guard API

```typescript
const router = this.getRouter() as unknown as RouterInstance;

// Global guard: runs for every navigation
router.addGuard((context) => {
	if (context.toRoute === "admin" && !isAdmin()) return "home";
	return true;
});

// Route-specific guard
router.addRouteGuard("protected", () => (isLoggedIn() ? true : "login"));

// Async guard
router.addRouteGuard("dashboard", async (ctx) => {
	const ok = await checkPermissions(ctx.toRoute);
	return ok ? true : false;
});

// Guards are chainable and can be added/removed at any time
router.addGuard(guard1).addGuard(guard2).addRouteGuard("x", guard3);
router.removeGuard(guard1);
```

### 2.5 Guard Return Values

| Return                                         | Effect                                             |
| ---------------------------------------------- | -------------------------------------------------- |
| `true`                                         | Allow navigation                                   |
| `false`                                        | Block (restore previous hash, no history entry)    |
| `"routeName"`                                  | Redirect to route (replace hash, no history entry) |
| `{ route, parameters?, componentTargetInfo? }` | Redirect with parameters                           |
| Anything else (`null`, `undefined`, `42`)      | Treated as block with warning                      |

### 2.6 How It Addresses Each Original Problem

| Problem from Issues                              | How This Repo Solves It                                                               |
| ------------------------------------------------ | ------------------------------------------------------------------------------------- |
| View B flashes before redirect to C              | Guards run **before** `parse()` delegates to the parent router. No view is created.   |
| `router.stop()` + `initialize()` still goes to B | Not needed. Guard returns `"C"` and the router never processes B's hash.              |
| Browser back to invalid state                    | Guard runs on every `parse()` including back/forward. Returns `false` or redirect.    |
| `navTo()` creates history entries                | Redirects use `replaceHash` (no history entry). Blocks restore previous hash.         |
| Guards scattered across controllers              | Centralized registration in `Component.init()` — one place for all guard logic.       |
| No async support (UI5's blocker)                 | Async guards natively supported. Generation counter handles concurrency.              |
| `beforeRouteMatched` has no `preventDefault()`   | Override at `parse()` level — earlier than any event. No need for `preventDefault()`. |

### 2.7 What This Is NOT

- **Not a security solution.** As SAP/openui5#3094 makes clear, client-side guards are UX measures. Server-side authorization is still required.
- **Not a replacement for `beforeRouteMatched` / `routePatternMatched`.** Those events still fire for allowed navigations. Guards add a pre-check layer.
- **Not permanent.** If UI5 natively implements CPOUI5FRAMEWORK-338, migration is straightforward: remove guard registrations, revert `routerClass`, use native API.

---

## 3. Test Coverage

| Category              | Count   | What's Tested                                                           |
| --------------------- | ------- | ----------------------------------------------------------------------- |
| Drop-in replacement   | 8       | navTo, parameters, events, getRoute — all work without guards           |
| Guard API             | 5       | add/remove/chain guards, cleanup on destroy                             |
| Allow navigation      | 3       | Global, route, async guards returning `true`                            |
| Block navigation      | 5       | Global, route, async guards returning `false`, errors, rejections       |
| Redirect              | 3       | String redirect, async redirect, GuardRedirect with parameters          |
| Guard context         | 2       | Context properties, fromRoute/fromHash tracking                         |
| Execution order       | 4       | Global before route, registration order, short-circuit, route isolation |
| Invalid values        | 1       | Non-boolean/string/object treated as block                              |
| GuardRedirect objects | 3       | Plain, with parameters, async                                           |
| Hash change (URL bar) | 3       | Direct URL blocked, unguarded proceeds, redirect restores hash          |
| Dynamic guard changes | 3       | State change respected, mid-session add/remove                          |
| Re-entrancy           | 2       | No infinite loops, cross-redirect settlement                            |
| Mixed sync/async      | 5       | All combinations of sync/async global + route guards                    |
| Overlapping async     | 2       | Generation counter, stale result discard                                |
| Rapid sequential      | 2       | Sync: all processed; async: only last wins                              |
| `_suppressNextParse`  | 1       | Validates synchronous `hashChanged` assumption                          |
| **QUnit Total**       | **76**  |                                                                         |
| E2E (guard-allow)     | 1       | Login then navigate to protected                                        |
| E2E (guard-block)     | 1       | Logged out, try protected → stays on home                               |
| E2E (guard-redirect)  | 1       | Navigate to forbidden → redirected                                      |
| E2E (browser-back)    | multi   | Back button respects guards                                             |
| E2E (direct-url)      | multi   | URL bar entry respects guards                                           |
| E2E (multi-route)     | multi   | Complex sequential navigations with state changes                       |
| E2E (nav-button)      | multi   | Button interactions trigger guards                                      |
| E2E (routing-basic)   | 1       | Smoke test                                                              |
| **E2E Total**         | **~24** |                                                                         |

---

## 4. Risks and Limitations

### 4.1 `parse()` is not a public API

`parse()` is an internal method of `sap.ui.core.routing.Router`. It's not documented as stable or public. However:

- It has been stable since the router's inception (2013+)
- It is the fundamental bridge between `HashChanger` and route matching
- Removing or renaming it would break the router's core architecture
- The `sap.m.routing.Router` inherits it unchanged

**Mitigation**: The `NativeRouterCompat.qunit.ts` test suite validates API parity with the native router. If a UI5 update changes `parse()`, these tests would catch it.

### 4.2 Redirect targets bypass guards

When a guard redirects (e.g., "forbidden" → "home"), the redirect target's guards are **not** evaluated. This is by design to prevent infinite loops, but means you cannot chain guard-redirect-guard.

**Mitigation**: Document this clearly. Design guard logic so redirect targets don't need their own guards, or use global guards for universal checks.

### 4.3 Async guard hash desync window

During async guard evaluation, the browser's URL bar shows the target hash (e.g., `#/protected`) while the guard is still deciding. If the guard ultimately blocks, the hash is restored — but there's a brief visual inconsistency.

**Mitigation**: Keep async guards fast. Use sync guards for instant decisions; reserve async for backend calls.

### 4.4 Initial navigation block leaves blank app

If a guard returns `false` (block) on the very first navigation (where `_currentHash` is `null`), no view is loaded and the app appears blank. This is because there's no "previous" route to restore to.

**Mitigation**: On initial navigation, prefer redirecting (`return "login"`) rather than blocking (`return false`). The demo app demonstrates this pattern.

---

## 5. Related Work and References

- [SAP/openui5#3411](https://github.com/SAP/openui5/issues/3411) — The primary issue motivating this project
- [SAP/openui5#3094](https://github.com/SAP/openui5/issues/3094) — Auth protection (server-side vs client-side)
- [SAP/openui5#1326](https://github.com/SAP/openui5/issues/1326) — Earliest "protect a route" request (2017)
- [wridgeu/ui5-poc-ewm-one-login#1](https://github.com/wridgeu/ui5-poc-ewm-one-login/issues/1) — Back-navigation to invalid state
- [CPOUI5FRAMEWORK-338](https://github.com/SAP/openui5/issues/3411#issuecomment-1012994735) — SAP internal backlog item (unimplemented as of 2026)
- [DSAG UI5 Best Practice: Routing](https://1dsag.github.io/UI5-Best-Practice/routing/) — Community routing guidelines
- [Vue Router Navigation Guards](https://router.vuejs.org/guide/advanced/navigation-guards.html) — The gold standard for SPA navigation guards
- [Plunker: UI5 preventing navigation](https://embed.plnkr.co/wp6yes) — @boghyon's sample for focus handling + navigation prevention
