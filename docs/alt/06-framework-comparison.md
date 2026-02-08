# Alternative 6: How Other Frameworks Solve Navigation Guards

This document compares how major web frameworks handle route-level navigation guards, to contextualize what `ui5.ext.routing` provides relative to industry standards.

---

## Vue Router (Vue.js)

**The gold standard for SPA navigation guards.**

### API

```javascript
// Global before guard
router.beforeEach(async (to, from) => {
	if (to.meta.requiresAuth && !isAuthenticated()) {
		return { name: "login" }; // redirect
	}
	return true; // allow
});

// Per-route guard
const routes = [
	{
		path: "/admin",
		component: AdminPanel,
		beforeEnter: (to, from) => {
			if (!isAdmin()) return "/";
		},
	},
];

// In-component guard (Options API)
export default {
	beforeRouteLeave(to, from) {
		if (this.hasUnsavedChanges) {
			return confirm("Discard changes?");
		}
	},
};

// In-component guard (Composition API)
import { onBeforeRouteLeave } from "vue-router";

onBeforeRouteLeave((to, from) => {
	if (hasUnsavedChanges.value) {
		return confirm("Discard changes?");
	}
});
```

### Guard Resolution Flow

Vue Router's guards execute in a precise, well-defined order:

```
1. beforeRouteLeave (in deactivated components)
2. beforeEach (global)
3. beforeRouteUpdate (in reused components)
4. beforeEnter (per-route config)
5. Resolve async route components
6. beforeRouteEnter (in activated components)
7. beforeResolve (global)
8. Navigation confirmed
9. afterEach (global)
10. DOM updates
```

**Key insight**: Leave guards run FIRST, before any global guards. This means the current route's component gets the first say in whether navigation should proceed.

### Concurrent Navigation Handling

Guards are resolved asynchronously, and the navigation is considered **pending** before all hooks have been resolved. If a new navigation is triggered while guards are pending, the previous navigation is cancelled.

### Key Design Choices

- **Async-first**: All guards can return Promises
- **Three levels**: Global, per-route, per-component
- **Return-value based**: Return `true` (allow), `false` (cancel), route location (redirect), or nothing (implicit allow)
- **`beforeRouteLeave`**: Guards can prevent LEAVING a route (unsaved changes)
- **Lazy evaluation**: Route components are not loaded until all guards pass
- **Navigation history**: Cancelled navigation doesn't create history entries
- **Composition API**: `onBeforeRouteLeave` and `onBeforeRouteUpdate` can be used in any component rendered by `<router-view>`, not just the direct route component
- **Error handling**: Throwing an `Error` from a guard cancels navigation

### Comparison with ui5.ext.routing

| Feature                 | Vue Router                                                  | ui5.ext.routing                          |
| ----------------------- | ----------------------------------------------------------- | ---------------------------------------- |
| Global guards           | `beforeEach`, `beforeResolve`, `afterEach`                  | `addGuard()`                             |
| Per-route guards        | `beforeEnter`                                               | `addRouteGuard()`                        |
| In-component guards     | `beforeRouteEnter`, `beforeRouteUpdate`, `beforeRouteLeave` | Not supported                            |
| Leave guards            | `beforeRouteLeave`                                          | Not supported                            |
| Async support           | Native                                                      | Native                                   |
| Route metadata          | `to.meta`                                                   | Via `context.toRoute` + external lookup  |
| Return values           | `true`, `false`, route location, `undefined`                | `true`, `false`, string, `GuardRedirect` |
| Concurrent nav handling | Auto-cancels pending navigation                             | `_parseGeneration` counter               |

**What ui5.ext.routing is missing**: Leave guards (`beforeRouteLeave`) and in-component guards. These could be added as future enhancements.

---

## Angular Router

### API

```typescript
// Route guard as a function (Angular 15+)
const routes: Routes = [
	{
		path: "admin",
		component: AdminComponent,
		canActivate: [() => inject(AuthService).isLoggedIn()],
	},
];

// Guard as injectable class (legacy pattern)
@Injectable()
export class AuthGuard implements CanActivate {
	canActivate(route: ActivatedRouteSnapshot): boolean | Observable<boolean> {
		if (!this.authService.isLoggedIn()) {
			this.router.navigate(["/login"]);
			return false;
		}
		return true;
	}
}

// Deactivation guard (leave guard)
@Injectable()
export class UnsavedChangesGuard implements CanDeactivate<FormComponent> {
	canDeactivate(component: FormComponent): boolean {
		if (component.hasUnsavedChanges()) {
			return confirm("Discard changes?");
		}
		return true;
	}
}
```

### Guard Types

| Guard              | When It Runs                         | Use Case                |
| ------------------ | ------------------------------------ | ----------------------- |
| `canActivate`      | Before entering a route              | Auth checks             |
| `canActivateChild` | Before entering child routes         | Nested auth             |
| `canDeactivate`    | Before leaving a route               | Unsaved changes         |
| `canLoad`          | Before lazy-loading a module         | Prevent code loading    |
| `canMatch`         | During route matching                | Dynamic route selection |
| `resolve`          | After guards pass, before activation | Pre-fetch data          |

### Key Design Choices

- **Dependency injection**: Guards are services, can inject other services
- **Observable support**: Guards can return `Observable<boolean>` for reactive patterns
- **`canLoad`**: Prevents even the lazy-loaded module from downloading
- **`canDeactivate`**: Receives the component instance, enabling direct state checks
- **Declarative**: Guards are listed in the route configuration, not registered programmatically

### Comparison with ui5.ext.routing

| Feature                 | Angular         | ui5.ext.routing              |
| ----------------------- | --------------- | ---------------------------- |
| Guard declaration       | In route config | Programmatic registration    |
| DI support              | Native          | N/A (UI5 doesn't have DI)    |
| Code loading prevention | `canLoad`       | N/A (UI5 always loads views) |
| Deactivation guards     | `canDeactivate` | Not supported                |
| Observable/reactive     | Native          | Promise-based                |

---

## React Router (v6.4+)

React Router takes a fundamentally different approach: **no explicit guard middleware**, but provides loader-based protection and a `useBlocker` hook for leave guards.

### Enter Protection: Loaders

```jsx
// Loader-based (v6.4+) — data fetched before render
const router = createBrowserRouter([
	{
		path: "/admin",
		loader: async () => {
			const user = await getUser();
			if (!user.isAdmin) throw redirect("/");
			return user;
		},
		element: <AdminPanel />,
	},
]);

// Component-based guard (traditional pattern)
function ProtectedRoute({ children }) {
	const { isAuthenticated } = useAuth();
	if (!isAuthenticated) return <Navigate to="/login" replace />;
	return children;
}
```

### Leave Protection: useBlocker

```jsx
import { useBlocker } from "react-router";

function EditForm() {
	const [isDirty, setIsDirty] = useState(false);
	const blocker = useBlocker(useCallback(() => isDirty, [isDirty]));

	return (
		<form onChange={() => setIsDirty(true)}>
			{/* form fields */}

			{blocker.state === "blocked" && (
				<dialog open>
					<p>You have unsaved changes!</p>
					<button onClick={() => blocker.proceed()}>Leave</button>
					<button onClick={() => blocker.reset()}>Stay</button>
				</dialog>
			)}
		</form>
	);
}
```

### Blocker States

| State          | Meaning                                       |
| -------------- | --------------------------------------------- |
| `"unblocked"`  | Navigation is not blocked                     |
| `"blocked"`    | Navigation is blocked, awaiting user decision |
| `"proceeding"` | User confirmed to proceed                     |

### Key Design Choices

- **No middleware API**: Guards are either component wrappers or loader functions
- **Loaders run in parallel**: All matching route loaders execute concurrently
- **`redirect()` from loaders**: Throw a `redirect()` to cancel and redirect
- **`useBlocker` for leave guards**: Component-level hook with `proceed()`/`reset()` API
- **No `beforeEach` equivalent**: Intentional — React favors composition over middleware
- **Limitation**: `useBlocker` does not handle hard-reloads or cross-origin navigations

### Comparison with ui5.ext.routing

| Feature              | React Router            | ui5.ext.routing        |
| -------------------- | ----------------------- | ---------------------- |
| Guard API            | None (composition)      | Explicit registration  |
| Pre-navigation check | Via loader + redirect() | Via parse() override   |
| Global guards        | Wrap root layout        | `addGuard()`           |
| Per-route guards     | Per-route loader        | `addRouteGuard()`      |
| Leave guards         | `useBlocker` hook       | Not supported          |
| Paradigm             | Declarative (JSX)       | Imperative (API calls) |

---

## TanStack Router

TanStack Router (formerly React Location) provides a more structured guard system than React Router. A [deep dive into its source code](./12-tanstack-router-deep-dive.md) reveals key architectural differences from `ui5.ext.routing`.

### Enter Protection: beforeLoad

```typescript
const adminRoute = createRoute({
	path: "/admin",
	beforeLoad: async ({ context, navigate }) => {
		if (!context.auth.isLoggedIn) {
			throw redirect({ to: "/login" });
		}
		// Can also enrich context for child routes
		const permissions = await loadPermissions();
		return { permissions };
	},
	component: AdminPanel,
});
```

### Leave Protection: useBlocker

```typescript
import { useBlocker } from "@tanstack/react-router";

function EditForm() {
	const blocker = useBlocker({
		shouldBlockFn: ({ current, next }) => {
			// Type-safe access to current and next locations
			return formIsDirty;
		},
	});

	// blocker has proceed() and reset() when status is "blocked"
}
```

### Bypassing Blockers

```typescript
// Link component
<Link to="/saved" ignoreBlocker>Save and Navigate</Link>

// Programmatic
navigate({ to: '/dashboard', ignoreBlocker: true });
```

### Key Design Choices

- **Fully async**: Unlike `ui5.ext.routing`'s sync-first design, TanStack's entire navigation pipeline (`load()` → `loadMatches()`) runs inside `async` functions. There is no synchronous fast path.
- **Two-layer architecture**: Blocking happens in the history library (`@tanstack/history`), while guarding (`beforeLoad` hooks) happens in the router's async `loadMatches()`. `ui5.ext.routing` combines both in `parse()`.
- **AbortController per match**: Each route match gets its own `AbortController`. When a new navigation starts, `cancelMatches()` aborts all pending controllers. This is more granular than `ui5.ext.routing`'s single `_parseGeneration` counter, but heavier.
- **`beforeLoad` hooks**: Run parent-to-child, each contributing to accumulated context
- **Context accumulation**: Parent route context flows to children (type-safe)
- **`ignoreBlocker`**: Specific navigations can bypass blockers (e.g., "Save & Navigate"). Redirects from guards automatically use `ignoreBlocker: true` — analogous to `ui5.ext.routing`'s `_redirecting` flag.
- **`cause` parameter**: `beforeLoad` receives `'preload' | 'enter' | 'stay'` to distinguish navigation reasons
- **No generation counter**: Uses `latestLoadPromise` tracking + AbortController instead

### Comparison with ui5.ext.routing

| Feature             | TanStack Router              | ui5.ext.routing                      |
| ------------------- | ---------------------------- | ------------------------------------ |
| Async model         | Fully async                  | Sync-first, async fallback           |
| Enter guards        | `beforeLoad` hook            | `addGuard()`, `addRouteGuard()`      |
| Leave guards        | `useBlocker` (history-level) | Not supported                        |
| Blocking layer      | History library              | Router `parse()`                     |
| Context passing     | Parent-to-child accumulation | Via `GuardContext`                   |
| Staleness detection | AbortController per match    | Generation counter                   |
| Bypass mechanism    | `ignoreBlocker` option       | `_redirecting` flag (redirects only) |
| Type safety         | Full route tree types        | Interface-based                      |

For a detailed source code analysis, see [Alternative 12: TanStack Router Deep Dive](./12-tanstack-router-deep-dive.md).

---

## Ember.js

Ember takes a unique approach with its **transition object** — a first-class entity that can be stored, aborted, and retried.

### API

```javascript
// In a Route class
import Route from '@ember/routing/route';

export default class ProtectedRoute extends Route {
    // Enter guard
    beforeModel(transition) {
        if (!this.authService.isLoggedIn) {
            // Store the transition for later retry
            this.loginController.previousTransition = transition;
            this.router.transitionTo('login');
        }
    }
}

// In the Login controller — retry after login
@action
login() {
    // ... authenticate ...
    let previousTransition = this.previousTransition;
    if (previousTransition) {
        this.previousTransition = null;
        previousTransition.retry();  // Resume the original navigation!
    } else {
        this.router.transitionTo('index');
    }
}
```

### Leave Protection: routeWillChange

```javascript
// In a Route or Component
this.router.on("routeWillChange", (transition) => {
	if (this.hasUnsavedChanges && !transition.to.find((route) => route.name === this.routeName)) {
		if (!confirm("Discard unsaved changes?")) {
			transition.abort();
		}
	}
});
```

### Transition Object API

| Method/Property      | Description                                |
| -------------------- | ------------------------------------------ |
| `transition.abort()` | Immediately stop the transition            |
| `transition.retry()` | Re-attempt a previously aborted transition |
| `transition.to`      | Route info for destination                 |
| `transition.from`    | Route info for origin                      |

### Key Design Choices

- **Transition as first-class object**: Transitions can be stored, aborted, and retried
- **`transition.retry()`**: Uniquely powerful — enables "redirect to login, then resume" pattern without the login page knowing the original destination
- **`routeWillChange` event**: Global interception point for leave guards
- **Route hooks**: `beforeModel`, `model`, `afterModel` all receive the transition
- **Limitation**: Browser back button changes the URL before `routeWillChange` fires

### Comparison with ui5.ext.routing

| Feature           | Ember.js                      | ui5.ext.routing                 |
| ----------------- | ----------------------------- | ------------------------------- |
| Enter guards      | `beforeModel` hook            | `addGuard()`, `addRouteGuard()` |
| Leave guards      | `routeWillChange` + `abort()` | Not supported                   |
| Store & retry     | `transition.retry()`          | Not supported                   |
| Transition object | First-class                   | Not applicable                  |
| Guard location    | In Route class                | Programmatic registration       |

---

## Nuxt 3

Nuxt wraps Vue Router's guards with a middleware abstraction.

### Route Middleware

```typescript
// middleware/auth.ts (named middleware)
export default defineNuxtRouteMiddleware((to, from) => {
	const { isLoggedIn } = useAuth();

	if (!isLoggedIn.value) {
		return navigateTo("/login");
	}
	// Return nothing = allow navigation
});

// middleware/admin.ts
export default defineNuxtRouteMiddleware((to, from) => {
	if (!isAdmin()) {
		return abortNavigation(); // Block completely
		// or: return abortNavigation(new Error('Forbidden'));
	}
});
```

### Middleware Types

| Type   | Definition                                                        | Scope            |
| ------ | ----------------------------------------------------------------- | ---------------- |
| Global | `middleware/name.global.ts`                                       | Every navigation |
| Named  | `middleware/name.ts` + `definePageMeta({ middleware: ['name'] })` | Specific pages   |
| Inline | `definePageMeta({ middleware: [(to, from) => {}] })`              | Single page      |

### Return Values

| Return                                   | Effect                                          |
| ---------------------------------------- | ----------------------------------------------- |
| Nothing / `undefined`                    | Allow navigation, proceed to next middleware    |
| `navigateTo('/path')`                    | Redirect (302 on server, client-side on client) |
| `navigateTo('/', { redirectCode: 301 })` | Permanent redirect                              |
| `abortNavigation()`                      | Block navigation                                |
| `abortNavigation(error)`                 | Block with error                                |

### Key Design Choices

- **No `next()` callback**: Return-value based (unlike Vue Router's legacy `next()`)
- **SSR-aware**: Middleware runs on both server and client
- **File-system conventions**: `.global.ts` suffix for automatic global registration
- **`definePageMeta`**: Declarative middleware assignment per page

---

## Next.js

Next.js uses edge middleware for server-side route protection.

### Edge Middleware

```typescript
// middleware.ts (project root)
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

export function middleware(request: NextRequest) {
	const token = request.cookies.get("auth-token");

	if (!token && request.nextUrl.pathname.startsWith("/admin")) {
		return NextResponse.redirect(new URL("/login", request.url));
	}

	return NextResponse.next();
}

export const config = {
	matcher: ["/admin/:path*", "/dashboard/:path*"],
};
```

### Key Design Choices

- **Server-side first**: Runs at the edge before the page is rendered
- **Matcher patterns**: Declarative path-based filtering
- **No client-side guard API**: Client-side protection is done via component-level redirects
- **Performance**: Runs before any page code loads

---

## Summary: Industry Standard Features

| Feature             | Vue        | Angular         | React              | TanStack           | Ember             | Nuxt              | Next            | **ui5.ext.routing**   |
| ------------------- | ---------- | --------------- | ------------------ | ------------------ | ----------------- | ----------------- | --------------- | --------------------- |
| Global before guard | Yes        | Yes             | Via loader         | `beforeLoad`       | `beforeModel`     | Global middleware | Edge middleware | **Yes**               |
| Per-route guard     | Yes        | Yes             | Via loader         | `beforeLoad`       | `beforeModel`     | Named middleware  | Matcher         | **Yes**               |
| In-component guard  | Yes        | No              | No                 | No                 | No                | No                | No              | No                    |
| Leave guard         | Yes        | `canDeactivate` | `useBlocker`       | `useBlocker`       | `routeWillChange` | Via Vue           | No              | **No**                |
| Transition retry    | No         | No              | No                 | No                 | **Yes**           | No                | No              | **No**                |
| Bypass mechanism    | No         | No              | No                 | `ignoreBlocker`    | No                | No                | No              | **No**                |
| Async support       | Yes        | Observable      | Yes                | Yes                | Yes               | Yes               | Yes             | **Yes**               |
| Route metadata      | `to.meta`  | `route.data`    | Loader             | Context            | No                | `definePageMeta`  | Matcher         | **No**                |
| Redirect            | Return loc | `navigate()`    | `throw redirect()` | `throw redirect()` | `transitionTo()`  | `navigateTo()`    | `redirect()`    | **Return string/obj** |
| History clean       | Yes        | Yes             | `replace`          | Yes                | Yes               | Yes               | Server          | **Yes**               |

### What ui5.ext.routing Provides Relative to Industry Standards

**Covered well:**

- Global and per-route guards (matches Vue, Angular)
- Async support (matches all frameworks)
- Redirect and block with clean history (matches all frameworks)
- Centralized registration (matches Vue's `beforeEach`)
- Concurrent navigation handling (matches Vue's pending navigation cancellation)

**Not yet covered (potential future enhancements):**

- **Leave guards** (`beforeRouteLeave` / `canDeactivate` / `useBlocker`): Preventing navigation AWAY from a route (e.g., unsaved form data). See [Alternative 8: Leave Guards](./08-leave-guards.md).
- **Transition object** (`transition.retry()`): Ember's unique pattern for storing and retrying aborted transitions. See [Alternative 9: Transition Object](./09-transition-object.md).
- **Route metadata**: Declaring guard conditions in the route config itself (e.g., `{ meta: { requiresAuth: true } }`). See [Alternative 10: Route Metadata](./10-route-metadata.md).
- **Bypass mechanism** (`ignoreBlocker`): Allowing specific navigations to skip guards. Useful for "Save & Navigate" patterns.
- **Code loading prevention**: Preventing lazy-loaded view code from being fetched until guards pass. UI5's view loading is tightly coupled to route matching, making this difficult.

## References

- [Vue Router Navigation Guards](https://router.vuejs.org/guide/advanced/navigation-guards.html)
- [Angular Route Guards](https://angular.io/guide/router#preventing-unauthorized-access)
- [React Router Navigation Blocking](https://reactrouter.com/how-to/navigation-blocking)
- [React Router useBlocker](https://reactrouter.com/en/main/hooks/use-blocker)
- [TanStack Router Navigation Blocking](https://tanstack.com/router/v1/docs/framework/react/guide/navigation-blocking)
- [Ember.js Preventing and Retrying Transitions](https://guides.emberjs.com/release/routing/preventing-and-retrying-transitions/)
- [Nuxt 3 Route Middleware](https://nuxt.com/docs/guide/directory-structure/middleware)
- [Next.js Middleware](https://nextjs.org/docs/app/building-your-application/routing/middleware)
- [SvelteKit Hooks](https://kit.svelte.dev/docs/hooks)
