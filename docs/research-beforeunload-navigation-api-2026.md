# Chrome/Chromium `beforeunload` and Navigation API Research (2026)

**Research Date**: February 8, 2026
**Purpose**: Understand recent browser changes to navigation event handling and their implications for UI5 routing guards

---

## Executive Summary

- **`beforeunload` is NOT deprecated** but has severe reliability issues, especially on mobile
- **`unload` IS being deprecated** by Chrome (rollout: March 2026 - September 2026)
- **Custom `beforeunload` messages were removed in Chrome 51** (April 2016) - only generic browser dialogs now
- **Navigation API** is now supported across all major browsers (as of January 2026) but **cannot replace `beforeunload`** for navigation guards
- **Recommended alternative**: `visibilitychange` event for state saving

---

## 1. `beforeunload` Event Status

### Current Status (2026)

- **NOT officially deprecated** but marked "Limited availability" on MDN
- Still functional but with significant caveats
- Not part of any formal deprecation timeline

### Key Changes Over Time

#### Chrome 51 (April 2016): Custom Messages Removed

- **What changed**: Custom strings in `beforeunload` dialogs were removed
- **Reason**: Developers were misusing the feature to scam users
- **Result**: Only generic browser-controlled messages are shown
- **Consistency**: Aligned Chrome with Safari 9.1+ and Firefox 4+

**Implementation**:

```javascript
// Modern approach (post-Chrome 51)
window.addEventListener("beforeunload", (event) => {
	event.preventDefault(); // Signal to show dialog
	event.returnValue = true; // Legacy support (Chrome/Edge < 119)
	// The return value is ignored - browser shows generic message
});
```

**Browser-controlled generic message examples**:

- Chrome: "Leave site? Changes you made may not be saved."
- Firefox: "This page is asking you to confirm that you want to leave..."
- Safari: "Are you sure you want to leave this page?"

### Reliability Issues

#### Mobile Platforms

`beforeunload` **does not fire reliably** on mobile:

- User switches to another app, then closes browser from app manager
- Many mobile browsers don't support it at all
- No workaround exists

#### Back/Forward Cache (bfcache)

- **Chrome/Safari**: Pages with `beforeunload` listeners ARE eligible for bfcache (as of 2024+)
- **Firefox**: Pages with `beforeunload` listeners are INELIGIBLE for bfcache
- **Impact**: Performance degradation in Firefox due to full page reloads

#### User Interaction Requirement

- Dialog only appears if page has received **sticky activation** (user gesture/interaction)
- If user never interacted with page, dialog won't show

### Best Practices (2026)

**Use sparingly and conditionally**:

```javascript
const beforeUnloadHandler = (event) => {
	event.preventDefault();
	event.returnValue = true; // Legacy support
};

// Only add listener when there are unsaved changes
formElement.addEventListener("input", (event) => {
	if (hasUnsavedChanges()) {
		window.addEventListener("beforeunload", beforeUnloadHandler);
	} else {
		window.removeEventListener("beforeunload", beforeUnloadHandler);
	}
});
```

**Key principle**: Add listener only when user has unsaved changes, remove immediately after saving.

---

## 2. `unload` Event Deprecation

### Timeline

**Chrome's phased rollout** (unload only, NOT beforeunload):

#### Phase 1: Top 50 Sites (Completed)

- **Chrome 142** (October 2025): Rollout completed for top 50 sites

#### Phase 2: All Origins (In Progress)

| Chrome Version | Month          | Percentage |
| -------------- | -------------- | ---------- |
| 146            | March 2026     | 1%         |
| 147            | April 2026     | 5%         |
| 148            | May 2026       | 10%        |
| 149            | June 2026      | 20%        |
| 150            | June 2026      | 40%        |
| 151            | July 2026      | 60%        |
| 152            | August 2026    | 80%        |
| 153            | September 2026 | 100%       |

### Why `unload` is Deprecated

1. **Unreliable**: Doesn't fire when background tabs are killed
2. **Performance**: Prevents bfcache usage on desktop
3. **Mobile**: Extremely unreliable on mobile platforms
4. **Better alternatives exist**: `visibilitychange`, `pagehide`, `fetchLater`

---

## 3. Navigation API

### Overview

- **Purpose**: Modern replacement for History API and `window.location`
- **Target audience**: Single-page applications (SPAs)
- **Spec location**: WHATWG HTML Living Standard
- **Status**: Part of Interop 2025 initiative

### Browser Support (2026)

| Browser | Supported Since | Version | Status       |
| ------- | --------------- | ------- | ------------ |
| Chrome  | February 2023   | 102+    | ✅ Supported |
| Edge    | February 2023   | 102+    | ✅ Supported |
| Firefox | January 2026    | 147+    | ✅ Supported |
| Safari  | January 2026    | 26.2+   | ✅ Supported |

**Global coverage**: 83.66% (as of January 2026)

### Core Capabilities

#### Intercepting Navigation

```javascript
navigation.addEventListener("navigate", (event) => {
	// Check if we can intercept
	if (!event.canIntercept) {
		return; // Cross-origin navigation
	}

	// Intercept and handle as same-document navigation
	event.intercept({
		handler: async () => {
			// Custom SPA routing logic
			await updatePageContent(event.destination.url);
		},
	});
});
```

#### Preventing Navigation

```javascript
navigation.addEventListener("navigate", (event) => {
	// Prevent navigation (with limitations)
	event.preventDefault();
});
```

### Limitations vs. `beforeunload`

The Navigation API **CANNOT replace `beforeunload`** for navigation guards:

| Capability               | `beforeunload`   | Navigation API       |
| ------------------------ | ---------------- | -------------------- |
| Cross-origin navigation  | ✅ Can intercept | ❌ Cannot intercept  |
| User confirmation dialog | ✅ Shows dialog  | ❌ No dialog support |
| Back/Forward button      | ✅ Can intercept | ❌ Cannot prevent    |
| Initial page load        | ✅ N/A           | ❌ Doesn't trigger   |
| Frame scope              | ✅ Window-level  | ❌ Single frame only |

**Critical constraint**: "You can't cancel a navigation via `preventDefault()` if the user is pressing the Back or Forward buttons."

**Design philosophy**: "You should not be able to trap your users on your site."

### When to Use Navigation API

✅ **Good for**:

- Same-document SPA routing
- Programmatic navigation control
- History state management
- Navigation lifecycle hooks

❌ **NOT suitable for**:

- Preventing navigation away from site
- User confirmation for unsaved changes
- Cross-origin navigation interception
- Back/Forward button blocking

---

## 4. Recommended Alternatives to `beforeunload`

### Primary: `visibilitychange` Event

**Most reliable alternative** for state saving:

```javascript
document.addEventListener("visibilitychange", () => {
	if (document.visibilityState === "hidden") {
		// Last reliable chance to save state
		saveApplicationState();
	}
});
```

**Advantages**:

- Works reliably on mobile
- Triggers when user switches tabs
- Triggers when browser is minimized
- Better bfcache compatibility

### Secondary: `pagehide` Event

```javascript
window.addEventListener("pagehide", (event) => {
	// Fires when navigating away, reloading, or closing
	if (event.persisted) {
		// Page entering bfcache
	} else {
		// Page being unloaded
	}
	saveApplicationState();
});
```

**Advantages**:

- Fires on navigation away
- Indicates bfcache entry via `persisted` property

### For Analytics: `fetchLater` API

```javascript
// Modern replacement for analytics in unload handlers
fetchLater("/analytics", {
	method: "POST",
	body: JSON.stringify(analyticsData),
});
```

**Advantages**:

- Browser optimizes delivery
- Doesn't block navigation
- More reliable than `sendBeacon`

### When to Still Use `beforeunload`

**Only for warning users about unsaved changes**:

```javascript
// GOOD: Conditional usage
let hasUnsavedChanges = false;

function enableUnsavedWarning() {
	if (!hasUnsavedChanges) {
		window.addEventListener("beforeunload", beforeUnloadHandler);
		hasUnsavedChanges = true;
	}
}

function disableUnsavedWarning() {
	if (hasUnsavedChanges) {
		window.removeEventListener("beforeunload", beforeUnloadHandler);
		hasUnsavedChanges = false;
	}
}

// Enable when form is dirty
form.addEventListener("input", enableUnsavedWarning);

// Disable after successful save
saveButton.addEventListener("click", async () => {
	await saveForm();
	disableUnsavedWarning();
});
```

---

## 5. Testing & Migration Guide

### Testing Deprecation Impact

#### Chrome DevTools

1. Open DevTools → Application → Back/forward cache
2. Test your page's bfcache eligibility
3. Check for blocking factors

#### Chrome Flags

Enable early testing:

```
chrome://flags/#deprecate-unload
```

### Migration Checklist

- [ ] Audit codebase for `unload` event usage
- [ ] Replace `unload` with `visibilitychange` or `pagehide`
- [ ] Review `beforeunload` usage - is it conditional?
- [ ] Test mobile behavior (especially iOS Safari)
- [ ] Verify bfcache compatibility
- [ ] Update analytics to use `fetchLater` or `sendBeacon`
- [ ] Consider Navigation API for SPA routing (not guards)

---

## 6. Implications for UI5 Routing Guards

### Current Approach

UI5-ext-routing implements async navigation guards that can prevent navigation based on business logic (e.g., unsaved changes, authentication checks).

### Browser Compatibility Issues

#### `beforeunload` Limitations

1. **No custom messages**: Cannot show specific reason for blocking
2. **User interaction required**: Won't trigger without prior user gesture
3. **Mobile unreliable**: May not work at all on mobile browsers
4. **Generic dialog only**: Browser controls message, no customization

#### Navigation API Not a Solution

1. **Same-document only**: Can't intercept navigation to external URLs
2. **No back/forward blocking**: Users can always use browser buttons
3. **No user prompts**: Can't force user decision dialog

### Recommended Hybrid Approach

```javascript
class ExtendedRouter {
	// For same-document (SPA) navigation
	setupNavigationAPI() {
		navigation.addEventListener("navigate", async (event) => {
			if (!event.canIntercept) return;

			event.intercept({
				handler: async () => {
					// Run async guards
					const guardResult = await this.runGuards(event.destination.url);

					if (!guardResult.canNavigate) {
						// Show custom UI modal (not browser dialog)
						const userChoice = await showCustomDialog(guardResult.reason);
						if (!userChoice.confirmed) {
							// Stay on current page
							return;
						}
					}

					// Proceed with navigation
					await this.navigateToRoute(event.destination.url);
				},
			});
		});
	}

	// For external/full-page navigation
	setupBeforeUnload() {
		// Only enable when guards might block
		this.on("routeMatched", () => {
			if (this.hasUnsavedChanges()) {
				window.addEventListener("beforeunload", this._beforeUnloadHandler);
			} else {
				window.removeEventListener("beforeunload", this._beforeUnloadHandler);
			}
		});
	}

	_beforeUnloadHandler(event) {
		// Generic browser dialog will show
		event.preventDefault();
		event.returnValue = true;
	}
}
```

### Key Recommendations

1. **Use Navigation API for SPA routing**:
    - Intercept same-document navigations
    - Show custom modal for guard failures
    - Provides better UX than browser dialogs

2. **Use `beforeunload` as fallback**:
    - Only for external navigation or page close
    - Accept limitation of generic browser message
    - Enable conditionally based on state

3. **Save state proactively**:
    - Use `visibilitychange` for auto-save
    - Don't rely on navigation guards to prevent data loss
    - Treat guards as UX enhancement, not data safety

4. **Mobile strategy**:
    - Accept that blocking navigation is unreliable
    - Implement aggressive auto-save
    - Consider server-side draft storage

---

## Sources

- [Deprecating the unload event | Chrome for Developers](https://developer.chrome.com/docs/web-platform/deprecating-unload)
- [Window: beforeunload event - MDN](https://developer.mozilla.org/en-US/docs/Web/API/Window/beforeunload_event)
- [Window: unload event - MDN](https://developer.mozilla.org/en-US/docs/Web/API/Window/unload_event)
- [Modern client-side routing: the Navigation API | Chrome for Developers](https://developer.chrome.com/docs/web-platform/navigation-api)
- [Navigation API - MDN](https://developer.mozilla.org/en-US/docs/Web/API/Navigation_API)
- [NavigateEvent: intercept() method - MDN](https://developer.mozilla.org/en-US/docs/Web/API/NavigateEvent/intercept)
- [API Deprecations and Removals in Chrome 51 | Chrome for Developers](https://developer.chrome.com/blog/chrome-51-deprecations)
- [Careful about Chrome 119 and beforeunload Event Listeners](https://chriscoyier.net/2023/11/15/careful-about-chrome-119-and-beforeunload-event-listeners/)
- [Back/forward cache | web.dev](https://web.dev/articles/bfcache)
- [Time to unload your unload events | RUMvision](https://www.rumvision.com/blog/time-to-unload-your-unload-events/)
- [Navigation API | Can I use](https://caniuse.com/mdn-api_navigation)
- [Chrome Platform Status - Custom beforeunload messages](https://chromestatus.com/feature/5349061406228480)
- [Chrome Platform Status - Unload deprecation](https://chromestatus.com/feature/5579556305502208)
- [WICG/navigation-api - GitHub](https://github.com/WICG/navigation-api)
- [WHATWG HTML - Navigation interface](https://html.spec.whatwg.org/#navigation-interface)

---

## Conclusion

**For UI5 routing guards in 2026**:

1. `beforeunload` remains the only option for blocking cross-origin/full-page navigation, but with severe limitations (generic message, mobile unreliable, requires user interaction)

2. Navigation API is excellent for SPA routing but cannot replace `beforeunload` for navigation guards (can't block back/forward, can't show dialogs, same-origin only)

3. Best practice: Treat navigation guards as UX enhancement, not data protection. Implement aggressive auto-save with `visibilitychange` as primary data safety mechanism.

4. Accept that perfect navigation blocking is no longer possible in modern browsers - this is intentional browser design to prevent user entrapment.
