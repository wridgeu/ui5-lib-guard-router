# Analysis: UI5 Navigation Guard Problem & This Repository's Solution

## 1. Problem Statement

UI5's native router (`sap.ui.core.routing.Router` / `sap.m.routing.Router`) has **no mechanism to intercept, guard, or cancel navigation before route matching and target display**. This is a long-standing gap that has been discussed across multiple GitHub issues and community forums since at least 2017. It leads to two well-documented problems.

### 1.1 Back-Navigation to Invalid States

**Reference**: [wridgeu/ui5-poc-ewm-one-login#1](https://github.com/wridgeu/ui5-poc-ewm-one-login/issues/1)

`navTo()` creates browser history entries. After a user completes a step (e.g., login), the browser back button can return them to a screen that should no longer be accessible (e.g., the login page after successful authentication). The framework provides no way to prevent this at the routing level.

### 1.2 No Route-Level Guards

**Reference**: [SAP/openui5#3411](https://github.com/SAP/openui5/issues/3411), CPOUI5FRAMEWORK-338

There is no way to prevent a route from displaying based on conditions (permissions, authentication state, feature flags). The `beforeRouteMatched` event fires but offers no `preventDefault()` capability. The framework team acknowledged this need (CPOUI5FRAMEWORK-338) but the feature remains unimplemented after 4+ years.

### 1.3 Key GitHub Issues

#### SAP/openui5#3411: "How to interrupt / override the ongoing routing?" (OPEN since Dec 2021)

- **Reporter**: @pubmikeb (OpenUI5 1.98.0)
- **Core scenario**: User clicks a sidebar item to navigate from view A to view B, but permissions should redirect them to view C instead. The user should **never see** view B.
- **Attempted approaches that failed**:
    1. `attachRoutePatternMatched`: view B flashes for a second before redirect
    2. `attachBeforeRouteMatched`: same flash problem
    3. `router.stop()` + `router.initialize(true)`: still navigates to B
    4. HashChanger manipulation: doesn't help
    5. `sap.m.library.URLHelper.redirect()`: works but forces a full page reload (performance hit)

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

#### SAP/openui5#3094: "Prevent showing the UI5 app internal page without successful authentication" (CLOSED)

- **Core scenario**: Client-side navigation can be manipulated via DevTools to bypass authentication checks
- **SAP response** (@matz3): _"You can't fully prevent a user from manipulating code that runs on the client-side"_. Recommended server-side authorization and separate components for public/authenticated content.
- **Key takeaway**: Client-side guards are UX measures, not security measures. Server-side authorization is still required.

#### SAP/openui5#1326: "Protect a route path" (CLOSED, 2017)

- Earliest documented request for route-level guards in UI5
- SAP's response: use `attachPatternMatched`, which is the "flash of unauthorized content" pattern

#### wridgeu/ui5-poc-ewm-one-login#1: "Prevent browser back navigation to not logged in screen"

- **Scenario**: After login, browser back button returns to "not logged in" screen despite still being authenticated
- **Root cause**: `navTo()` creates browser history entries, allowing users to navigate "back" to invalid states
- **Proposed solutions**: Conditional rendering (no routes for login state), `navTo` with `bReplace: true`, custom Router extension, composable guard helper, component-registration API
- **Connection to this repo**: Directly motivated the development of `ui5.guard.router`

### 1.4 The Core Problem Summarized

| Problem                                        | Impact                                                                       |
| ---------------------------------------------- | ---------------------------------------------------------------------------- |
| No pre-navigation interception                 | Views load before guard logic can run                                        |
| Flash of unauthorized content                  | Users briefly see protected pages before redirect                            |
| `beforeRouteMatched` has no `preventDefault()` | Event fires too late, can't cancel                                           |
| History pollution                              | `navTo()` always creates history entries; back button reaches invalid states |
| Scattered guard logic                          | Guards duplicated across every controller's `onInit`/`attachPatternMatched`  |
| No async guard support                         | UI5's event system is synchronous; can't check backend permissions           |
| No centralized guard registry                  | No single place to define "route X requires condition Y"                     |

### 1.5 The Deadlock

The UI5 team wants to implement this natively but faces a dilemma:

- Their current event system is synchronous
- A synchronous-only guard solution would prevent async permission checks
- Making it async requires fundamental framework changes
- The framework modernization effort takes priority
- **Result: 4+ years with no native solution** (CPOUI5FRAMEWORK-338 remains on the backburner)

### 1.6 Current Workaround

Developers scatter guard logic across every controller's `onInit` or `attachPatternMatched` callbacks:

```typescript
// In every protected controller
onInit() {
  this.getRouter().getRoute("protected")
    .attachPatternMatched(this._onRouteMatched, this);
}

_onRouteMatched() {
  if (!this.isLoggedIn()) {
    this.getRouter().navTo("login");
    // Problem: The "protected" view already rendered briefly (flash)
    // Problem: A history entry was created for "protected"
  }
}
```

#### Why This Fails

1. **Flash of unauthorized content**: The target view is instantiated and displayed before the controller can redirect. Users see the protected content for a split second.
2. **Polluted history**: The redirect creates additional history entries, making browser back/forward behavior unpredictable.
3. **Scattered logic**: Every protected controller must independently implement the same guard check. This violates DRY and is error-prone.
4. **No centralized control**: There is no single place to define "route X requires condition Y". Guards are implicit, buried in controller lifecycle methods.

### 1.7 What's Needed

A routing solution that:

- Intercepts navigation **before** any target loading, view creation, or event firing
- Supports async conditions (e.g., checking auth tokens, fetching permissions)
- Allows blocking navigation entirely (stay on current route, clean history)
- Allows redirecting to an alternative route (replace history, no extra entries)
- Provides a centralized registration point (Component level, not scattered across controllers)
- Is a drop-in replacement for `sap.m.routing.Router` (swap `routerClass` in manifest.json)
- Preserves all existing router behavior when no guards are registered

---

## 2. Implementation Approaches Considered

### 2.1 Event-Based Guard (Extend `beforeRouteMatched`)

**Idea**: Attach to the existing `beforeRouteMatched` event and add a `preventDefault()` mechanism.

**Pros**:

- Aligns with UI5's event system patterns
- No method overrides needed

**Cons**:

- `beforeRouteMatched` fires **after** internal route matching has already occurred. The target is about to be displayed. Preventing at this stage requires undoing work the router already started (view creation may have begun).
- The event is synchronous -- no async guard support without fundamentally changing the event system.
- Cannot cleanly prevent history entry creation since the hash has already changed.

**Verdict**: Rejected. Too late in the lifecycle; cannot prevent the view flash.

### 2.2 Override `navTo()` Only

**Idea**: Override `navTo()` to run guards before triggering navigation.

**Pros**:

- Simple, clear interception point for programmatic navigation
- Guards run before any hash change

**Cons**:

- Does **not** catch browser back/forward button navigation
- Does **not** catch direct URL/hash changes (user typing in address bar)
- Would need additional HashChanger listeners to cover all entry points, creating complexity and potential race conditions

**Verdict**: Rejected. Incomplete coverage of navigation entry points.

### 2.3 Override `parse()` (Chosen Approach)

**Idea**: Override `parse(sNewHash)`, the single method through which all navigation flows.

**Pros**:

- **Complete coverage**: Every navigation path (programmatic `navTo`, browser back/forward, URL bar changes) flows through `parse()`. One override catches everything.
- **Earliest possible interception**: Guards run before route matching, target loading, view creation, and event firing. No flash, no unnecessary work.
- **Clean blocking**: When a guard blocks, we simply don't call `super.parse()`. The framework never begins processing. We restore the previous hash via `replaceHash()`.
- **Minimal surface**: Single method override. Less code, fewer bugs, easier to maintain.
- **Async-friendly**: Synchronous guards execute in the same tick as the hash change. Async guards are supported via a deferred path with a generation counter to handle concurrent navigations.

**Cons**:

- `parse()` is not a public/documented-stable API. In theory, a future UI5 version could rename or refactor it. In practice, it has been stable since the router's inception and is fundamental to how `HashChanger` integration works.
- Need to manually determine which route matches the hash (using `Route#match()`) to build guard context and run per-route guards.

**Verdict**: **Chosen**. Best coverage, earliest interception, minimal code.

### 2.4 Custom HashChanger Wrapper

**Idea**: Wrap or replace the `HashChanger` instance to intercept hash changes before they reach the router.

**Pros**:

- Intercepts at the absolute earliest point
- No router method overrides

**Cons**:

- HashChanger is a singleton shared across all routers. Wrapping it affects the entire application.
- Complex lifecycle management (when to wrap, when to unwrap).
- Breaks if multiple routers exist (nested components, component reuse).
- Tight coupling to HashChanger internals which have changed across versions.

**Verdict**: Rejected. Too invasive, too fragile with multiple components.

### 2.5 Middleware/Plugin Pattern

**Idea**: Create a standalone plugin that attaches to any router instance, without subclassing.

**Pros**:

- No subclassing required
- Could work with any router implementation

**Cons**:

- Still needs to hook into `parse()` or `navTo()` via monkey-patching, which is worse than a clean override.
- No type-safe integration with the router class.
- Harder to discover and configure.

**Verdict**: Rejected. Monkey-patching is worse than clean inheritance.

### 2.6 Why `sap.m.routing.Router`

We extend `sap.m.routing.Router` rather than `sap.ui.core.routing.Router` because:

- ~99% of UI5 apps use `sap.m` controls with `NavContainer` / `SplitApp`
- `sap.m.routing.Router` adds `TargetHandler` for animated view transitions
- Extending it preserves all mobile navigation behavior
- Apps swap in via `"routerClass": "ui5.guard.router.Router"` in manifest.json

### 2.7 Minimum UI5 Version

**1.118** required due to [`sap.ui.core.Lib`](https://sdk.openui5.org/api/sap.ui.core.Lib) used for library initialization (introduced in 1.118). The Router itself only depends on APIs available since 1.75 (notably `getRouteInfoByHash`), but the library packaging sets the effective floor. Developed and tested against OpenUI5 1.144.0.

---

## 3. How This Repository Solves It

### 3.1 The Key Insight: Override `parse()`

Every navigation path in UI5 flows through a single method: `parse(sNewHash)`.

```
User clicks link      →  navTo()      →  hashChanged  →  parse()
Browser back/forward  →                  hashChanged  →  parse()
Direct URL entry      →                  hashChanged  →  parse()
```

By overriding `parse()`, we intercept **all** navigation at the earliest possible point, before route matching, target loading, view creation, or event firing.

### 3.2 Architecture Overview

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
                    │  │ Run leave guards (fromRoute)    │ │
                    │  │ Run global enter guards         │ │
                    │  │ Run route enter guards          │ │
                    │  │                                 │ │
                    │  │ true  → _commitNavigation()     │ │
                    │  │ false → _restoreHash()          │ │
                    │  │ string/redirect → navTo(replace)│ │
                    │  └─────────────────────────────────┘ │
                    └─────────────────────────────────────┘
```

### 3.3 Design Decisions

| Decision                                  | Rationale                                                                                                                     |
| ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Override `parse()` not `navTo()`          | `navTo()` doesn't catch browser back/forward or direct URL changes                                                            |
| Synchronous-first pipeline                | When all guards return plain values, navigation completes in the same tick as the hash change. No flash, no framework desync. |
| Async fallback with generation counter    | Async guards are supported but deferred. A monotonic counter prevents stale results from overlapping navigations.             |
| `_redirecting` flag bypasses guards       | Prevents infinite loops when a guard redirects to another guarded route                                                       |
| `_suppressNextParse` for hash restoration | `replaceHash()` fires `hashChanged` synchronously; the flag prevents double-processing                                        |
| Strict `true` for allow                   | Only `=== true` allows navigation. Truthy values like `1`, `"yes"`, `{}` are treated as blocks to prevent accidental allows.  |
| `.extend()` pattern, not ES6 class        | Required for UI5 class registry; enables `"routerClass": "ui5.guard.router.Router"` in manifest.json                          |

### 3.4 Guard API

```typescript
const router = this.getRouter() as unknown as GuardRouter;

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

// Leave guard: blocks navigation away from a route
router.addLeaveGuard("editOrder", (ctx) => {
	return !hasUnsavedChanges(); // false blocks, true allows
});

// Object form: register enter + leave guard in one call
router.addRouteGuard("editOrder", {
	beforeEnter: (ctx) => (isLoggedIn() ? true : "login"),
	beforeLeave: (ctx) => !hasUnsavedChanges(),
});

// Guards are chainable and can be added/removed at any time
router.addGuard(guard1).addGuard(guard2).addRouteGuard("x", guard3);
router.removeGuard(guard1);
```

### 3.5 Guard Return Values

| Return                                         | Effect                                             |
| ---------------------------------------------- | -------------------------------------------------- |
| `true`                                         | Allow navigation                                   |
| `false`                                        | Block (restore previous hash, no history entry)    |
| `"routeName"`                                  | Redirect to route (replace hash, no history entry) |
| `{ route, parameters?, componentTargetInfo? }` | Redirect with parameters                           |
| Anything else (`null`, `undefined`, `42`)      | Treated as block with warning                      |

### 3.6 How It Addresses Each Original Problem

| Problem from Issues                              | How This Repo Solves It                                                              |
| ------------------------------------------------ | ------------------------------------------------------------------------------------ |
| View B flashes before redirect to C              | Guards run **before** `parse()` delegates to the parent router. No view is created.  |
| `router.stop()` + `initialize()` still goes to B | Not needed. Guard returns `"C"` and the router never processes B's hash.             |
| Browser back to invalid state                    | Guard runs on every `parse()` including back/forward. Returns `false` or redirect.   |
| `navTo()` creates history entries                | Redirects use `replaceHash` (no history entry). Blocks restore previous hash.        |
| Guards scattered across controllers              | Centralized registration in `Component.init()`: one place for all guard logic.       |
| No async support (UI5's blocker)                 | Async guards natively supported. Generation counter handles concurrency.             |
| `beforeRouteMatched` has no `preventDefault()`   | Override at `parse()` level, earlier than any event. No need for `preventDefault()`. |

### 3.7 What This Is NOT

- **Not a security solution.** As SAP/openui5#3094 makes clear, client-side guards are UX measures. Server-side authorization is still required.
- **Not a replacement for `beforeRouteMatched` / `routePatternMatched`.** Those events still fire for allowed navigations. Guards add a pre-check layer.
- **Not permanent.** If UI5 natively implements CPOUI5FRAMEWORK-338, migration is straightforward: remove guard registrations, revert `routerClass`, use native API.

### 3.8 Migration Path

If UI5 natively implements route guards (CPOUI5FRAMEWORK-338), migration is straightforward:

1. Remove guard registrations from `Component.ts`
2. Change `routerClass` back to `sap.m.routing.Router` in manifest.json
3. Register equivalent guards using the native API

No application logic changes needed beyond the guard definitions themselves.

---

## 4. Test Coverage

| Category                      | Count  | What's Tested                                                                                               |
| ----------------------------- | ------ | ----------------------------------------------------------------------------------------------------------- |
| Drop-in replacement           | 7      | isA, navTo, parameters, routeMatched/beforeRouteMatched events, getRoute                                    |
| Guard API                     | 5      | add/remove/chain guards, cleanup on destroy                                                                 |
| Allow navigation              | 3      | Global, route, async guards returning `true`                                                                |
| Block navigation              | 5      | Global, route, async guards returning `false`, errors, rejections                                           |
| Redirect                      | 2      | String redirect, async string redirect                                                                      |
| Guard context                 | 1      | Context properties (toRoute, toHash, toArguments, fromRoute, fromHash)                                      |
| Execution order               | 4      | Global before route, registration order, short-circuit, route isolation                                     |
| Invalid values                | 1      | Non-boolean/string/object treated as block                                                                  |
| GuardRedirect objects         | 3      | Plain, with parameters, async                                                                               |
| Hash change (URL bar)         | 3      | Direct URL blocked, unguarded proceeds, redirect restores hash                                              |
| Dynamic guard changes         | 3      | State change respected, mid-session add/remove                                                              |
| Re-entrancy                   | 2      | No infinite loops, cross-redirect settlement                                                                |
| Mixed sync/async              | 5      | All combinations of sync/async global + route guards                                                        |
| Overlapping async             | 2      | Slower first superseded by faster second, stale result discard                                              |
| Guard context across navs     | 2      | fromRoute/fromHash tracking, empty on initial nav                                                           |
| Async guard edge cases        | 6      | Async route throw/reject, multi-async short-circuit, async redirect, null, undefined                        |
| Rapid sequential              | 2      | Sync: all processed; async: only last wins                                                                  |
| Current route dedup           | 1      | Navigating back to current route cancels pending async guard                                                |
| GuardRedirect componentTarget | 1      | GuardRedirect with componentTargetInfo                                                                      |
| Destroy during pending        | 1      | Router destroy while async guard is pending                                                                 |
| AbortSignal                   | 4      | Signal on context, aborted on supersede, aborted on destroy, aborted on same-route                          |
| Superseded nav stops guards   | 2      | Guards stop executing when navigation is superseded                                                         |
| Duplicate/overlapping nav     | 4      | Same-destination dedup, different-destination supersede, re-navigable after complete, AbortError silenced   |
| Leave guards                  | 23     | Sync/async allow/block, execution order, short-circuit, object form, chaining, removeRouteGuard object form |
| **QUnit Total**               | **92** |                                                                                                             |
| NativeCompat (API parity)     | 3      | isA, public routing methods, additional guard methods                                                       |
| NativeCompat (Route matching) | 3      | match() known/unknown hashes, getRouteInfoByHash                                                            |
| **Compat Total**              | **6**  |                                                                                                             |
| E2E (guard-allow)             | 1      | Login then navigate to protected                                                                            |
| E2E (guard-block)             | 1      | Logged out, try protected → stays on home                                                                   |
| E2E (guard-redirect)          | 1      | Navigate to forbidden → redirected                                                                          |
| E2E (browser-back)            | 4      | Back button respects guards across login states                                                             |
| E2E (direct-url)              | 5      | URL bar entry respects guards for protected/home/forbidden                                                  |
| E2E (multi-route)             | 3      | Complex sequential navigations with state changes                                                           |
| E2E (nav-button)              | 2      | UI5 in-app NavButton interactions                                                                           |
| E2E (routing-basic)           | 1      | Smoke test                                                                                                  |
| E2E (leave-guard)             | 4      | Dirty form leave guard: allow clean, block dirty, clear state, browser back                                 |
| **E2E Total**                 | **22** |                                                                                                             |

---

## 5. Risks and Limitations

### 5.1 `parse()` is not a public API

`parse()` is an internal method of `sap.ui.core.routing.Router`. It's not documented as stable or public. However:

- It has been stable since the router's inception (2013+)
- It is the fundamental bridge between `HashChanger` and route matching
- Removing or renaming it would break the router's core architecture
- The `sap.m.routing.Router` inherits it unchanged

**Mitigation**: The `NativeRouterCompat.qunit.ts` test suite validates API parity with the native router. If a UI5 update changes `parse()`, these tests would catch it.

### 5.2 Redirect targets bypass guards

When a guard redirects (e.g., "forbidden" → "home"), the redirect target's guards are **not** evaluated. This is by design to prevent infinite loops, but means you cannot chain guard-redirect-guard.

**Mitigation**: Document this clearly. Design guard logic so redirect targets don't need their own guards, or use global guards for universal checks.

### 5.3 Async guard hash desync window

During async guard evaluation, the browser's URL bar shows the target hash (e.g., `#/protected`) while the guard is still deciding. If the guard ultimately blocks, the hash is restored, but there's a brief visual inconsistency.

**Mitigation**: Keep async guards fast. Use sync guards for instant decisions; reserve async for backend calls.

### 5.4 Initial navigation block leaves blank app

If a guard returns `false` (block) on the very first navigation (where `_currentHash` is `null`), no view is loaded and the app appears blank. This is because there's no "previous" route to restore to.

**Mitigation**: On initial navigation, prefer redirecting (`return "login"`) rather than blocking (`return false`). The demo app demonstrates this pattern.

---

## 6. Related Work and References

- [SAP/openui5#3411](https://github.com/SAP/openui5/issues/3411): The primary issue motivating this project
- [SAP/openui5#3094](https://github.com/SAP/openui5/issues/3094): Auth protection (server-side vs client-side)
- [SAP/openui5#1326](https://github.com/SAP/openui5/issues/1326): Earliest "protect a route" request (2017)
- [wridgeu/ui5-poc-ewm-one-login#1](https://github.com/wridgeu/ui5-poc-ewm-one-login/issues/1): Back-navigation to invalid state
- [CPOUI5FRAMEWORK-338](https://github.com/SAP/openui5/issues/3411#issuecomment-1012994735): SAP internal backlog item (unimplemented as of 2026)
- [DSAG UI5 Best Practice: Routing](https://1dsag.github.io/UI5-Best-Practice/routing/): Community routing guidelines
- [Vue Router Navigation Guards](https://router.vuejs.org/guide/advanced/navigation-guards.html): The gold standard for SPA navigation guards
- [Plunker: UI5 preventing navigation](https://embed.plnkr.co/wp6yes): @boghyon's sample for focus handling + navigation prevention
