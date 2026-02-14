# Changelog

## [1.1.0](https://github.com/wridgeu/ui5-lib-guard-router/compare/v1.0.0...v1.1.0) (2026-02-14)


### Features

* add AbortSignal to guard context and early bailout on superseded navigations ([ad79694](https://github.com/wridgeu/ui5-lib-guard-router/commit/ad79694992d2c300b0c868d1a39c1f8c3b70119b))
* add leave guards ([55d1abc](https://github.com/wridgeu/ui5-lib-guard-router/commit/55d1abc0b2a905ac0fb7dada2d8d3a1824b39325))
* add leave guards with sync-first async pipeline ([c91b20f](https://github.com/wridgeu/ui5-lib-guard-router/commit/c91b20fd4178c2e3e11f5b14404e85e1f987e322))
* add removeRouteGuard object form and improve guard internals ([2315e3e](https://github.com/wridgeu/ui5-lib-guard-router/commit/2315e3ed99c885da987fa8f6695fb95d9014f82f))
* commits produce 0.1.0 instead. ([d056665](https://github.com/wridgeu/ui5-lib-guard-router/commit/d0566650bfc6ae629943c7009742acc7c95ee94c))
* dedup against in-flight pending navigations to avoid restarting guards ([c7ab8e4](https://github.com/wridgeu/ui5-lib-guard-router/commit/c7ab8e4a89caa89bcb18f3bd8887063cd3b1d9a9))
* initial implementation of ui5.ext.routing library with async navigation guards ([6b70dcb](https://github.com/wridgeu/ui5-lib-guard-router/commit/6b70dcb75de3d0371b0515aebffe84d527f768fc))
* namespace rename, CI/CD & npm release readiness ([#4](https://github.com/wridgeu/ui5-lib-guard-router/issues/4)) ([b79e5bf](https://github.com/wridgeu/ui5-lib-guard-router/commit/b79e5bfbb94682ae5341c008502eb172784fd624))


### Bug Fixes

* add route context to async enter guard error message ([d634a5d](https://github.com/wridgeu/ui5-lib-guard-router/commit/d634a5d7bcc4c3c415e0aedd8a02630d0097cd00))
* address code review findings across router and tests ([c344440](https://github.com/wridgeu/ui5-lib-guard-router/commit/c34444073e35502527e02838707ed2ca24b1d92a))
* address review findings from original issues analysis ([f5eb158](https://github.com/wridgeu/ui5-lib-guard-router/commit/f5eb1588a3b95089e7f3927e1386424fdf7d65ef))
* correct docs, README types, compat test, and async error logs ([0958f38](https://github.com/wridgeu/ui5-lib-guard-router/commit/0958f383df663fc9432c2900875b750504902a76))
* improve enter guard log prefix, handler cleanup, and test diagnostics ([5427c27](https://github.com/wridgeu/ui5-lib-guard-router/commit/5427c27daec54f8475889a07bc3d95b7a4db2420))
* improve guard error logs with route context and empty config warning ([b953c72](https://github.com/wridgeu/ui5-lib-guard-router/commit/b953c728529396d961e5dd2478e29ce470256b11))
* keep UI5 tooling in workspace deps and fix two hanging tests ([79b11c1](https://github.com/wridgeu/ui5-lib-guard-router/commit/79b11c1b12e3ffea7fe341a088c78a4f7464b28b))
* null-safe type guards, generation counter, and comprehensive test coverage ([3bbbaed](https://github.com/wridgeu/ui5-lib-guard-router/commit/3bbbaedd06f07437d6a1aba113489ec2798a9dbe))
* split RouterInstance into public/internal types, fix destroy during async guard ([97a1efb](https://github.com/wridgeu/ui5-lib-guard-router/commit/97a1efb3030d9fe9f6fdf84e656976d6ce8b55a3))
* tighten type guards, deduplicate helpers, and fix mermaid line breaks ([8f2fb51](https://github.com/wridgeu/ui5-lib-guard-router/commit/8f2fb51a3ccec5f49d4d5fa3438be7c0caaa65a9))
* update repository URLs to match renamed repo ([276a327](https://github.com/wridgeu/ui5-lib-guard-router/commit/276a32767dffa374eac56eeee5f19f1a5da2cbc1))
* update state before firing events in _commitNavigation ([1c4b0cc](https://github.com/wridgeu/ui5-lib-guard-router/commit/1c4b0ccf23e274abef7dfe46b84c0f002170837b))

## 1.0.0 (2026-02-14)


### Features

* add AbortSignal to guard context and early bailout on superseded navigations ([ad79694](https://github.com/wridgeu/ui5-lib-guard-router/commit/ad79694992d2c300b0c868d1a39c1f8c3b70119b))
* add leave guards ([55d1abc](https://github.com/wridgeu/ui5-lib-guard-router/commit/55d1abc0b2a905ac0fb7dada2d8d3a1824b39325))
* add leave guards with sync-first async pipeline ([c91b20f](https://github.com/wridgeu/ui5-lib-guard-router/commit/c91b20fd4178c2e3e11f5b14404e85e1f987e322))
* add removeRouteGuard object form and improve guard internals ([2315e3e](https://github.com/wridgeu/ui5-lib-guard-router/commit/2315e3ed99c885da987fa8f6695fb95d9014f82f))
* commits produce 0.1.0 instead. ([d056665](https://github.com/wridgeu/ui5-lib-guard-router/commit/d0566650bfc6ae629943c7009742acc7c95ee94c))
* dedup against in-flight pending navigations to avoid restarting guards ([c7ab8e4](https://github.com/wridgeu/ui5-lib-guard-router/commit/c7ab8e4a89caa89bcb18f3bd8887063cd3b1d9a9))
* initial implementation of ui5.ext.routing library with async navigation guards ([6b70dcb](https://github.com/wridgeu/ui5-lib-guard-router/commit/6b70dcb75de3d0371b0515aebffe84d527f768fc))
* namespace rename, CI/CD & npm release readiness ([#4](https://github.com/wridgeu/ui5-lib-guard-router/issues/4)) ([b79e5bf](https://github.com/wridgeu/ui5-lib-guard-router/commit/b79e5bfbb94682ae5341c008502eb172784fd624))


### Bug Fixes

* add route context to async enter guard error message ([d634a5d](https://github.com/wridgeu/ui5-lib-guard-router/commit/d634a5d7bcc4c3c415e0aedd8a02630d0097cd00))
* address code review findings across router and tests ([c344440](https://github.com/wridgeu/ui5-lib-guard-router/commit/c34444073e35502527e02838707ed2ca24b1d92a))
* address review findings from original issues analysis ([f5eb158](https://github.com/wridgeu/ui5-lib-guard-router/commit/f5eb1588a3b95089e7f3927e1386424fdf7d65ef))
* correct docs, README types, compat test, and async error logs ([0958f38](https://github.com/wridgeu/ui5-lib-guard-router/commit/0958f383df663fc9432c2900875b750504902a76))
* improve enter guard log prefix, handler cleanup, and test diagnostics ([5427c27](https://github.com/wridgeu/ui5-lib-guard-router/commit/5427c27daec54f8475889a07bc3d95b7a4db2420))
* improve guard error logs with route context and empty config warning ([b953c72](https://github.com/wridgeu/ui5-lib-guard-router/commit/b953c728529396d961e5dd2478e29ce470256b11))
* keep UI5 tooling in workspace deps and fix two hanging tests ([79b11c1](https://github.com/wridgeu/ui5-lib-guard-router/commit/79b11c1b12e3ffea7fe341a088c78a4f7464b28b))
* null-safe type guards, generation counter, and comprehensive test coverage ([3bbbaed](https://github.com/wridgeu/ui5-lib-guard-router/commit/3bbbaedd06f07437d6a1aba113489ec2798a9dbe))
* split RouterInstance into public/internal types, fix destroy during async guard ([97a1efb](https://github.com/wridgeu/ui5-lib-guard-router/commit/97a1efb3030d9fe9f6fdf84e656976d6ce8b55a3))
* tighten type guards, deduplicate helpers, and fix mermaid line breaks ([8f2fb51](https://github.com/wridgeu/ui5-lib-guard-router/commit/8f2fb51a3ccec5f49d4d5fa3438be7c0caaa65a9))
* update repository URLs to match renamed repo ([276a327](https://github.com/wridgeu/ui5-lib-guard-router/commit/276a32767dffa374eac56eeee5f19f1a5da2cbc1))
* update state before firing events in _commitNavigation ([1c4b0cc](https://github.com/wridgeu/ui5-lib-guard-router/commit/1c4b0ccf23e274abef7dfe46b84c0f002170837b))
