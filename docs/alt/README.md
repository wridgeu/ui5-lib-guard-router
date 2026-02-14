# Alternative Approaches & Extension Ideas

This folder contains research documents exploring alternative implementations for UI5 navigation guards and potential extensions to the current `parse()` override approach. Each document includes detailed analysis, code examples, and a verdict.

## At a Glance

| #   | Document                                                         | Category      | Verdict                                                                                 |
| --- | ---------------------------------------------------------------- | ------------- | --------------------------------------------------------------------------------------- |
| 01  | [Event-Based (PatternMatched)](#01---event-based-patternmatched) | Alternative   | Usable as quick workaround, but causes content flash and history pollution              |
| 02  | [HashChanger Interception](#02---hashchanger-interception)       | Alternative   | Fragile, globally scoped, labeled "bad practice" by the UI5 team                        |
| 03  | [Conditional Rendering](#03---conditional-rendering)             | Alternative   | Simplest for binary login/logout, but no per-route guards or deep linking               |
| 04  | [Component Separation](#04---component-separation)               | Alternative   | SAP-recommended for code isolation, but heavy overhead and no per-route guards          |
| 05  | [navTo with bReplace](#05---navto-with-breplace)                 | Complementary | Zero-risk fix for history pollution; already used internally by this library            |
| 06  | [Framework Comparison](#06---framework-comparison)               | Reference     | Survey of Vue, Angular, React, TanStack, Ember, Nuxt, Next.js, SvelteKit guard patterns |
| 07  | [navTo Override](#07---navto-override)                           | Alternative   | **Rejected.** Only catches programmatic navigation, misses back/forward and URL entry   |
| 08  | [Leave Guards](#08---leave-guards)                               | Extension     | "Are you sure you want to leave?" guards for unsaved changes                            |
| 09  | [Transition Object](#09---transition-object)                     | Extension     | Ember-inspired retry mechanism for "redirect to login, then resume" flows               |
| 10  | [Route Metadata](#10---route-metadata)                           | Extension     | Declarative `requiresAuth`, `roles` on routes so one guard handles all checks           |
| 11  | [Bypass Guards](#11---bypass-guards)                             | Extension     | Mechanism to skip guards for specific navigations (logout, post-login retry)            |
| 12  | [TanStack Router Deep Dive](#12---tanstack-router-deep-dive)     | Reference     | Source-level analysis of TanStack Router's navigation pipeline and blocking model       |

## Alternative Approaches

These documents explore different ways to solve the same problem the current `parse()` override solves. Most were evaluated and rejected during development.

### 01 - Event-Based (PatternMatched)

Uses `attachPatternMatched` / `attachBeforeRouteMatched` to detect navigation and redirect. The route is already matched and the view already rendering by the time the event fires, so users see a brief flash of protected content. Guard logic ends up scattered across controllers.

**When to use**: Only when you cannot add library dependencies and need a quick-and-dirty workaround.

> [01-event-based-pattern-matched.md](01-event-based-pattern-matched.md)

### 02 - HashChanger Interception

Monkey-patches the `HashChanger` singleton to intercept hash changes before they reach the router. Earliest possible interception point, but `HashChanger` is shared globally -- breaks in multi-component scenarios and Fiori Launchpad. The UI5 team has explicitly called this "bad practice."

**When to use**: Last resort only.

> [02-hashchanger-interception.md](02-hashchanger-interception.md)

### 03 - Conditional Rendering

Removes auth state from routing entirely. Uses model binding and `visible` toggling to switch between a login gate and the app. No hash changes, no history entries for login transitions.

**When to use**: Apps with a single binary state (logged in / logged out) and no per-route permission needs.

> [03-conditional-rendering.md](03-conditional-rendering.md)

### 04 - Component Separation

Splits the app into a public Component (login) and an authenticated Component (the real app), loaded dynamically after auth succeeds. Provides strong client-side code isolation.

**When to use**: When code isolation matters (e.g., lazy-loading the authenticated bundle). Still needs per-route guards within the authenticated component.

> [04-component-separation.md](04-component-separation.md)

### 05 - navTo with bReplace

Uses `navTo`'s fourth parameter (`bReplace: true`) to replace the current history entry instead of pushing a new one. Prevents "back to login" after logging in.

**When to use**: Always -- it's a zero-risk improvement. The guard router already uses this internally for redirects.

> [05-navto-replace-history.md](05-navto-replace-history.md)

### 07 - navTo Override

Overrides only `navTo()` to run guards before triggering navigation. Simple, but only covers programmatic navigation (~50% of navigation paths). Browser back/forward and direct URL entry are completely unguarded.

**Verdict**: Rejected in favor of the `parse()` override, which catches all navigation paths.

> [07-navto-override.md](07-navto-override.md)

## Extension Ideas

These documents explore features that could be added on top of the current `parse()` override. All are designed to be backward compatible.

### 08 - Leave Guards

"Are you sure you want to leave?" guards that prevent navigation **away** from a route (e.g., unsaved form data). Recommends `addLeaveGuard(routeName, fn)` / `removeLeaveGuard(routeName, fn)` as the primary API, with optional retry support and a React-inspired blocker pattern in later phases.

> [08-leave-guards.md](08-leave-guards.md)

### 09 - Transition Object

An Ember-inspired `NavigationIntent` object added to `GuardContext`. Can be stored, checked for staleness, and retried later -- enabling "redirect to login, complete auth, then resume the original navigation" without manually tracking target URLs.

> [09-transition-object.md](09-transition-object.md)

### 10 - Route Metadata

Declarative metadata on route definitions (`requiresAuth`, `roles`, `featureFlag`) so a single global guard can handle all permission logic by reading `context.toMeta` instead of writing per-route guards. Recommends a hybrid of manifest-declared metadata plus a runtime `setRouteMeta()` API.

> [10-route-metadata.md](10-route-metadata.md)

### 11 - Bypass Guards

A mechanism for specific navigations to skip all guards (logout, "Save & Navigate", post-login retry). Recommends a `skipGuards` option on `navTo()` for its simplicity. Combined with the transition object's `retrySkipGuards()`, this covers the major bypass scenarios.

> [11-bypass-guards.md](11-bypass-guards.md)

## Reference Documents

### 06 - Framework Comparison

Comprehensive survey of navigation guard patterns across Vue Router, Angular Router, React Router, TanStack Router, Ember.js, Nuxt 3, and Next.js. Covers global guards, per-route guards, leave guards, async support, transition retry, bypass, and route metadata. Useful for understanding where `ui5.guard.router` sits relative to industry standards.

> [06-framework-comparison.md](06-framework-comparison.md)

### 12 - TanStack Router Deep Dive

Source-level analysis of TanStack Router's internal navigation pipeline: its two-layer architecture (history blocking + router guarding), per-match AbortControllers, redirect handling, and concurrent navigation resolution. Compares against the sync-first `parse()` override and identifies potential takeaways like `AbortSignal` in guard context (since implemented).

> [12-tanstack-router-deep-dive.md](12-tanstack-router-deep-dive.md)

## Notes on UI5 Routing Evolution

### Async Routing Merge (May 2025)

In May 2025, SAP merged [`CPOUI5FRAMEWORK-776`](https://github.com/SAP/openui5/commit/b7fc43c46cee8c5b6371b4a895d1c86d82e431bf) ("[INTERNAL] core/routing: merge async version to the base"), making async routing the default code path. The sync implementation files (`sync/Route.js`, `sync/Target.js`, `sync/TargetCache.js`, `sync/Targets.js`) are slated for removal in UI5 2.x. Manifest Version 2 makes `routing/config/async: true` implicit.

This is significant because the SAP team cited the synchronous nature of the hash-change/`parse()` cycle as the **blocker** for implementing navigation guards (see [#3411 comment, September 2022](https://github.com/SAP/openui5/issues/3411#issuecomment-1239439104)). That technical barrier is now partially removed. However, `parse()` itself remains synchronous — the async merge affects target/view loading _after_ route matching, not the `parse()` entry point. The SAP team has not built guard features on top of this change.

**Impact on this library:** None. The `parse()` override still works identically. The async routing merge actually aligns well with this library's design — async guard resolution feeds naturally into async target loading.

### UI5 2.0 Outlook

[Issue #4234](https://github.com/SAP/openui5/issues/4234) tracks the UI5 2.0 roadmap. As of July 2025, no timeline is published. The 1.136.x-legacy-free version serves as the baseline — everything deprecated there will be removed in 2.x. There is **no indication** that UI5 2.0 will include navigation guard features. The `parse()` method is not on the deprecation list, and the `.extend()` class pattern remains supported.
