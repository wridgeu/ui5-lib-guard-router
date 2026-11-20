# Documentation Map

The docs are grouped by who reads them.

## Using the library

- [Library README](../packages/lib/README.md): installation, API, guard behavior, browser history, FLP integration, compatibility with `sap.m.routing.Router`. It is the npm page, so it is one file.
- [Guides](./guides/)
    - [Migration from attachPatternMatched](./guides/migration-from-pattern-matched.md)
    - [Guard integration patterns](./guides/integration-patterns.md)
    - [Keep-alive apps in the launchpad](./guides/flp-keep-alive.md)
    - [Native router compatibility: test evidence](./guides/native-router-compatibility.md)
- [Demo app README](../packages/demo-app/README.md): what the demo shows and how its E2E tests are organized

## Contributing to the library

- [CONTRIBUTING.md](../CONTRIBUTING.md): setup, test commands, where tests go, quality checks, releases
- [Reference](./reference/)
    - [Architecture](./reference/architecture.md): how the router works inside, the UI5 internals it relies on, the test architecture
    - [Upstream parity](./reference/upstream-parity.md): the tests that compare with the native router, private UI5 coupling
    - [Module loading and destroy safety](./reference/module-loading-and-destroy-safety.md)
    - [Problem analysis](./reference/analysis.md)

## Design history

Why the library is the way it is. These documents record decisions; the reference above describes the current state.

- [Feature notes](./features/README.md): one decision record per feature, with its status
- [Explorations](./explorations/README.md): alternative approaches and extension ideas evaluated during development

## External facts

What UI5, the Fiori launchpad and browsers do, with sources.

- [Research](./research/)
    - [FLP dirty state](./research/flp-dirty-state.md)
    - [Native NavContainer navigate event](./research/native-router-navigate-event.md)
    - [Beforeunload and Navigation API](./research/beforeunload-navigation-api-2026.md)
    - [Stale closure invalidation patterns](./research/stale-closure-invalidation-patterns.md)
    - [Library loading order](./research/library-loading-order.md)
    - [View caching and controller lifecycle](./research/view-caching-controller-lifecycle.md)
- [Investigations](./investigations/): problems found in the tooling, as they were when they were found
    - [QUnit test truncation](./investigations/01-qunit-test-truncation.md)
