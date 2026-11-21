# Feature: Guard Bypass

> **Status**: Implemented as `GuardNavToOptions.skipGuards` (since 1.5.0). See the [library README](../../packages/lib/README.md) for the API. `Router.ts` (`navTo`) is the source of truth.

## Prefer state over bypass

Most cases that seem to need a bypass are better solved by updating application state so the guards pass on their own: set `isDirty = false` after saving, set `isLoggedIn = false` before navigating to login. This keeps the guards the single place that decides. For that reason the feature was first deprioritized, and state updates remain the preferred approach.

## Problem

Every `navTo()` runs the full guard pipeline. Some navigations should not:

- **Save and navigate**: the form is saved, so the dirty-form leave guard ([Feature 01](./01-leave-guards.md)) should not ask.
- **Logout**: the user explicitly leaves, whatever the guards say.
- **System navigation**: navigation the app starts on its own, not subject to user-facing guards.

## API

The options object is the last argument of either `navTo()` form. It may also take the place of an omitted `bReplace`:

```typescript
router.navTo("orderList", {}, false, { skipGuards: true });
router.navTo("orderList", {}, undefined, { skipGuards: true });
router.navTo("orderList", {}, componentTargetInfo, false, { skipGuards: true });
```

The type is `GuardNavToOptions`. `navTo()` returns `this`.

The router option `navToPreflight: "bypass"` skips guards for every `navTo()` call.

## Decisions

| Decision                        | Choice                                                                                                     | Reason                                                                                                |
| ------------------------------- | ---------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| Options argument vs. new method | Options argument on `navTo()`. A dedicated `navToSkipGuards()` was not shipped.                            | One method, no extra API surface. Sugar can be added if the signature proves a pain point.            |
| How `parse()` skips the guards  | `navTo()` enters the committing phase (origin `"preflight"`) and calls `super.navTo()`; `parse()` commits. | The proposal's `_skipNextGuards` flag could leak to the next navigation when the hash did not change. |
| Hash unchanged                  | `navTo()` commits directly.                                                                                | Nothing is left set for the next navigation.                                                          |
| Granularity                     | All guards or none. No `skipLeaveGuards` / `skipEnterGuards`.                                              | No use case yet.                                                                                      |
| Navigation sources              | `navTo()` only. Browser back/forward and URL entry always run guards.                                      | The bypass is for code that has already validated the transition.                                     |
| Global switch                   | No `suspendGuards()` / `withoutGuards()`.                                                                  | A forgotten resume disables every guard, and an async gap leaves all navigations unguarded meanwhile. |

## Behavior

- A navigation to the hash the router is already on is deduped before `skipGuards` is checked.
- A `skipGuards` navigation to a target whose guards are still pending cancels that navigation and commits.
- The option applies to one call. It does not persist.

## Compatibility

`navTo()` calls without the options argument behave as before. The options come last, so existing positional arguments are unaffected.
