# Analysis: UI5 Navigation Guard Problem and Router-Override Approach

## 1. Problem Statement

UI5's native router (`sap.ui.core.routing.Router` / `sap.m.routing.Router`) cannot intercept, guard or cancel a navigation before route matching and target display. GitHub issues have asked for it since 2017.

### 1.1 Back-Navigation to Invalid States

`navTo()` creates browser history entries. After a step such as a login, the browser back button returns the user to a screen that should no longer be reachable, such as the login page. The router offers no way to prevent this.

### 1.2 No Route-Level Guards

**Reference**: [UI5/openui5#3411](https://github.com/UI5/openui5/issues/3411), CPOUI5FRAMEWORK-338

A route cannot be kept from displaying based on a condition (permissions, authentication state, feature flags). `beforeRouteMatched` fires but has no `preventDefault()`. The UI5 team acknowledged the need (CPOUI5FRAMEWORK-338); it is not implemented.

### 1.3 Key GitHub Issues

#### UI5/openui5#3411: "How to interrupt / override the ongoing routing?" (OPEN since Dec 2021)

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

#### UI5/openui5#3094: "Prevent showing the UI5 app internal page without successful authentication" (CLOSED)

- **Core scenario**: Client-side navigation can be manipulated via DevTools to bypass authentication checks
- **SAP response** (@matz3): _"You can't fully prevent a user from manipulating code that runs on the client-side"_. Recommended server-side authorization and separate components for public/authenticated content.
- **Key takeaway**: Client-side guards are UX measures, not security measures. Server-side authorization is still required.

#### UI5/openui5#1326: "Protect a route path" (CLOSED, 2017)

- Earliest documented request for route-level guards in UI5
- SAP's response: use `attachPatternMatched`, which is the "flash of unauthorized content" pattern

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

UI5's event system is synchronous, and a synchronous-only guard cannot wait for a permission check on the backend. An async solution needs framework changes, and the UI5 team gives the framework modernization priority. At the last update in the issue (October 2024) there was no progress. In May 2025 the async routing code became the base implementation ([`CPOUI5FRAMEWORK-776`](https://github.com/UI5/openui5/commit/b7fc43c46cee8c5b6371b4a895d1c86d82e431bf)), but that concerns loading targets after the route match: `parse()` is still synchronous, and the UI5 2.0 roadmap ([#4234](https://github.com/UI5/openui5/issues/4234)) mentions no guards.

### 1.6 Current Workaround

Without guards, every controller checks access in `onInit` or in an `attachPatternMatched` callback:

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

The view renders before the redirect, the redirect adds a history entry, and the same check is repeated in every protected controller (the rows of the table in 1.4).

### 1.7 What's Needed

A router that:

- Intercepts navigation **before** any target loading, view creation, or event firing
- Supports async conditions (e.g., checking auth tokens, fetching permissions)
- Blocks a navigation (stays on the current route, leaves the history clean)
- Redirects to another route (replaces the history entry, adds none)
- Registers guards in one place (the Component, not each controller)
- Replaces `sap.m.routing.Router` through `routerClass` in manifest.json
- Behaves like the native router when no guards are registered

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

**Verdict**: Rejected as a standalone approach. Incomplete coverage of navigation entry points.

The navTo override concept was later adopted as one half of a two-entry-point design: navTo() preflight + parse() fallback. See [architecture.md](architecture.md).

### 2.3 Override `parse()` (Chosen Approach)

**Idea**: Override `parse(sNewHash)`, the single method through which all navigation flows.

**Pros**:

- **Complete coverage**: Every navigation path (programmatic `navTo`, browser back/forward, URL bar changes) flows through `parse()`. One override catches everything.
- **Earliest possible interception**: Guards run before route matching, target loading, view creation, and event firing. No flash, no unnecessary work.
- **Clean blocking**: When a guard blocks, we simply don't call `super.parse()`. The framework never begins processing. The router undoes the hash change: a history step back, or a write of the full previous hash ([Undoing a hash change](architecture.md#undoing-a-hash-change)).
- **One place for every hash change**: `parse()` catches all of them; a `navTo()` preflight and the lifecycle overrides (`initialize`, `stop`, `destroy`) sit alongside it.
- **Async-friendly**: Synchronous guards execute in the same tick as the hash change. Async guards are supported via a deferred path with a generation counter to handle concurrent navigations.

**Cons**:

- `parse()` is not documented as stable API (see [5.1](#51-parse-is-not-a-public-api)).
- The router has to find the route that matches the hash (`getRouteInfoByHash()`) to build the guard context and run per-route guards.

**Verdict**: **Chosen**. Best coverage, earliest interception, least code.

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

- Most UI5 apps display their views in a `sap.m` `NavContainer` or `SplitApp`
- `sap.m.routing.Router` adds `TargetHandler` for animated view transitions
- Extending it preserves all mobile navigation behavior
- Apps swap in via `"routerClass": "ui5.guard.router.Router"` in manifest.json

### 2.7 Minimum UI5 Version

The package declares **1.136.0** as its minimum, which manifest version 2 requires, and is developed against **1.144.0**. The code itself needs **1.120**, for `DataType.registerEnum` (used for the `NavigationOutcome` enum); CI runs the library suite on 1.120 to keep it that way. Other APIs used include [`sap.ui.core.Lib`](https://sdk.openui5.org/#/api/sap.ui.core.Lib) for library initialization and `getRouteInfoByHash` from 1.75.

### 2.8 App-Level Alternatives

Approaches that need no router change, and why they do not replace guards:

- **Conditional rendering** (a container that shows the login view until the user is logged in): covers a single logged-in/logged-out gate only. There are no per-route rules, and deep links land on the gate.
- **Separate components** (protected views in a component loaded after login): isolates the code, but still has no per-route guards, makes deep links harder and adds component overhead in the launchpad.
- **`navTo(..., bReplace = true)`** on login and logout: keeps the login page out of the history, so back does not return to it. It is worth doing with guards as well, but it does nothing for URLs typed or bookmarked.
- **Browser events** (as of 2026): `beforeunload` covers leaving the document only, with a generic browser dialog that needs a prior user gesture and is unreliable on mobile. The `navigate` event of the Navigation API cannot block back/forward and cannot ask the user. Both suit full-page exits, not routing between views.

---

## 3. Router-Override Approach

### 3.1 The Key Insight: Override `parse()`

Every hash change in UI5 flows through a single method: `parse(sNewHash)`.

```
User clicks link      →  navTo()      →  hashChanged  →  parse()
Browser back/forward  →                  hashChanged  →  parse()
Direct URL entry      →                  hashChanged  →  parse()
```

By overriding `parse()`, we intercept every hash change before route matching, target loading, view creation, or event firing. Programmatic `navTo()` gets an additional preflight that runs the same guards before the hash changes, so a blocked or redirected `navTo()` leaves no history entry (see [Two-Entry-Point Model](./architecture.md#two-entry-point-model-navto-preflight--parse-fallback)). Targets displayed without a route (`getTargets().display()`) change no hash and run no guards.

### 3.2 Architecture Overview

The checks `parse()` makes before the guards run, and what each decision does, are drawn in
[architecture.md, parse() Override](./architecture.md#parse-override---fallback-for-browser-initiated-navigation).

### 3.3 Design Decisions

| Decision                                                | Rationale                                                                                                                      |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Override `parse()`, plus a `navTo()` preflight          | `navTo()` alone misses browser back/forward and direct URL changes; the preflight keeps programmatic history clean             |
| Synchronous-first pipeline                              | When all guards return plain values, navigation completes in the same tick as the hash change. No flash, no framework desync.  |
| Async fallback with generation counter                  | Async guards are supported but deferred. A monotonic counter prevents stale results from overlapping navigations.              |
| Guards evaluate on redirect targets with loop detection | Visited-set + depth cap prevents infinite loops; committing/redirect phase used only for the final commit step                 |
| `_suppressedHash` for hash restoration                  | `replaceHash()` fires `hashChanged` synchronously; `parse()` ignores the hash that `_restoreHash()` is writing                 |
| Strict `true` for allow                                 | Only `=== true` allows navigation. Other truthy values like `1` or `{}` block; a non-empty string redirects.                   |
| ES class with `@namespace` JSDoc                        | `@namespace` triggers `babel-plugin-transform-modules-ui5` to emit `.extend()`, giving the class its own UI5 metadata identity |

### 3.4 Guard API

The API is in the library README, [API](../../packages/lib/README.md#api): global, route and leave guards, the object form `{ beforeEnter, beforeLeave }`, and chainable registration and removal.

### 3.5 Guard Return Values

`true` allows, `false` blocks, a route name or a `GuardRedirect` redirects, and any other value blocks with a warning. The table with the effect of each is in the library README, [Return values](../../packages/lib/README.md#return-values-guardresult); the history effects are in [Browser history](../../packages/lib/README.md#browser-history).

### 3.6 How It Addresses Each Original Problem

| Problem from Issues                              | How This Repo Solves It                                                              |
| ------------------------------------------------ | ------------------------------------------------------------------------------------ |
| View B flashes before redirect to C              | Guards run **before** `parse()` delegates to the parent router. No view is created.  |
| `router.stop()` + `initialize()` still goes to B | Not needed. Guard returns `"C"` and the router never processes B's hash.             |
| Browser back to invalid state                    | Guard runs on every `parse()` including back/forward. Returns `false` or redirect.   |
| `navTo()` creates history entries                | `navTo()` runs guards before the hash changes; only the final target is written.     |
| Guards scattered across controllers              | Centralized registration in `Component.init()`: one place for all guard logic.       |
| No async support (UI5's blocker)                 | Async guards natively supported. Generation counter handles concurrency.             |
| `beforeRouteMatched` has no `preventDefault()`   | Override at `parse()` level, earlier than any event. No need for `preventDefault()`. |

### 3.7 What This Is NOT

- **Not a security solution.** As UI5/openui5#3094 makes clear, client-side guards are UX measures. Server-side authorization is still required.
- **Not a replacement for `beforeRouteMatched` / `routePatternMatched`.** Those events still fire for allowed navigations. Guards add a pre-check layer.

### 3.8 Migration Path

If UI5 implements route guards natively (CPOUI5FRAMEWORK-338):

1. Remove guard registrations from `Component.ts`
2. Change `routerClass` back to `sap.m.routing.Router` in manifest.json
3. Register equivalent guards using the native API

The guard functions themselves carry over; only their registration changes.

---

## 4. Test Coverage

The QUnit suites are registered in `packages/lib/test/qunit/testsuite.qunit.ts`, the E2E specs are in `packages/demo-app/test/e2e/` and `packages/demo-app/test/flp/`. See [Test Architecture](./architecture.md#test-architecture).

---

## 5. Risks and Limitations

### 5.1 `parse()` is not a public API

`parse()` is a method of `sap.ui.core.routing.Router` that is not documented as stable. It is the bridge between `HashChanger` and route matching, has kept its role since the router was introduced, and `sap.m.routing.Router` inherits it unchanged. The private members the router depends on besides it are listed in [UI5 Internals the Router Relies On](./architecture.md#ui5-internals-the-router-relies-on).

**Mitigation**: The tests in `packages/lib/test/qunit/parity/native/` compare the router with the native one on both UI5 lanes. A change to `parse()` fails them.

### 5.2 Redirect targets evaluate guards with loop detection

The guards of a redirect target run before the navigation commits, so a chain of redirects is possible. A hash that comes again in the chain, or a chain longer than `MAX_REDIRECT_DEPTH` (10 hops), is blocked with an error log ([architecture.md, design decision 3](./architecture.md#parse-override---fallback-for-browser-initiated-navigation)).

### 5.3 Async guard hash desync window

While an async guard decides a browser-initiated navigation (back/forward, address bar), the address bar shows the target hash. A block or redirect puts it back afterwards. A `navTo()` has no such window: its preflight runs the guards before the hash changes. Keep async guards fast ([library README](../../packages/lib/README.md#url-bar-shows-target-hash-during-async-guards-browser-initiated-only)).

### 5.4 Initial navigation block behavior

If a guard blocks the very first navigation (where `_currentHash` is `null`):

- **Non-empty hash blocked**: The hash is restored to `""` with `suppressParse=false`, so the default route still loads. The app is not left blank.
- **Empty hash (default route) blocked**: No view is loaded and the app stays blank: there is no route to fall back to.

**Mitigation**: On the initial navigation, redirect (`return "login"`) instead of blocking (`return false`).

---

## 6. Related Work and References

- [UI5/openui5#3411](https://github.com/UI5/openui5/issues/3411): The primary issue motivating this project; SAP tracks it internally as CPOUI5FRAMEWORK-338
- [UI5/openui5#3094](https://github.com/UI5/openui5/issues/3094): Auth protection (server-side vs client-side)
- [UI5/openui5#1326](https://github.com/UI5/openui5/issues/1326): Earliest "protect a route" request (2017)
- [DSAG UI5 Best Practice: Routing](https://1dsag.github.io/UI5-Best-Practice/routing/): Community routing guidelines
- [Vue Router Navigation Guards](https://router.vuejs.org/guide/advanced/navigation-guards.html): The gold standard for SPA navigation guards
- [Plunker: UI5 preventing navigation](https://embed.plnkr.co/wp6yes): @boghyon's sample for focus handling + navigation prevention
