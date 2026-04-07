# Documentation Map

This directory groups the repository's longer-form documentation by intent.

## Sections

- [Reference](./reference/)
    - [Architecture](./reference/architecture.md)
    - [Problem analysis](./reference/analysis.md)
    - [Upstream parity](./reference/upstream-parity.md)
- [Guides](./guides/)
    - [Migration from attachPatternMatched](./guides/migration-from-pattern-matched.md)
    - [Guard integration patterns](./guides/integration-patterns.md)
- [Investigations](./investigations/)
    - [QUnit test truncation](./investigations/01-qunit-test-truncation.md)
- [Research](./research/)
    - [FLP dirty state](./research/flp-dirty-state.md)
    - [Native NavContainer navigate event](./research/native-router-navigate-event.md)
    - [Beforeunload and Navigation API](./research/beforeunload-navigation-api-2026.md)
    - [Stale closure invalidation patterns](./research/stale-closure-invalidation-patterns.md)
    - [Library loading order](./research/library-loading-order.md)
    - [View caching and controller lifecycle](./research/view-caching-controller-lifecycle.md)
- [Explorations](./explorations/README.md)
    - Alternative approaches and extension ideas evaluated during development
- [Feature notes](./features/README.md)
    - Shipped capabilities, historical design notes, and follow-up proposals for `ui5.guard.router.Router`
    - [Vendored OpenUI5 router parity suite](./features/07-vendored-openui5-router-parity.md)

## Notes

- Consumer-facing usage and API docs live in `packages/lib/README.md`.
- The demo app has its own implementation notes in `packages/demo-app/README.md`.
