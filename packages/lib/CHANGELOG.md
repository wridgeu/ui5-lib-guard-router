# Changelog

## [1.3.1](https://github.com/wridgeu/ui5-lib-guard-router/compare/v1.3.0...v1.3.1) (2026-03-21)


### Bug Fixes

* **router:** prevent guard bypass during redirects and fix event API ([be9de35](https://github.com/wridgeu/ui5-lib-guard-router/commit/be9de3548ef5d35319a184b24ffb0d3be1a5a9c1))

## [1.3.0](https://github.com/wridgeu/ui5-lib-guard-router/compare/v1.2.0...v1.3.0) (2026-03-20)


### Features

* add navigationSettled event via UI5 EventProvider ([0c80ec2](https://github.com/wridgeu/ui5-lib-guard-router/commit/0c80ec25a973b5c2d663d838766b2d3bd23abe66))
* add navTo() preflight guard evaluation ([58e0aff](https://github.com/wridgeu/ui5-lib-guard-router/commit/58e0affe5e81c009c99a3fb0b08e7b33706ae637))
* **router:** add bypassed settlement outcome and harden guard edge cases ([7ce94ae](https://github.com/wridgeu/ui5-lib-guard-router/commit/7ce94ae95c00f2363e4d1ef0343c2e0f70775167))


### Bug Fixes

* cancel pending navigation on unknown-route navTo, audit fixes ([#35](https://github.com/wridgeu/ui5-lib-guard-router/issues/35)) ([4690269](https://github.com/wridgeu/ui5-lib-guard-router/commit/4690269ac7a61ba0ceba0e640c9f7d107e33507d))
* **docs:** correct broken links, log table accuracy, and test coverage refs ([84edc10](https://github.com/wridgeu/ui5-lib-guard-router/commit/84edc1068aea3a3fd016582f4a8fbe901b564503))
* **docs:** correct log-level URL parameter and settlement type usage ([992dc5e](https://github.com/wridgeu/ui5-lib-guard-router/commit/992dc5e023010182e888d2854ce7de4ddeef9acc))
* **router:** align object-form invalid guard warning ([eb4d409](https://github.com/wridgeu/ui5-lib-guard-router/commit/eb4d4096ca4000575f445a48598be902cbd9cc02))
* **router:** validate leave guard results and harden test reliability ([01e5350](https://github.com/wridgeu/ui5-lib-guard-router/commit/01e5350ef7f9f353e9e0c7d8fc4c028435332deb))

## [1.2.0](https://github.com/wridgeu/ui5-lib-guard-router/compare/v1.1.1...v1.2.0) (2026-03-17)


### Features

* add navigationSettled() API with NavigationOutcome enum ([41cff49](https://github.com/wridgeu/ui5-lib-guard-router/commit/41cff491da2aebce3e1f0f920497f5718f5bdabf))
* **demo:** enable enhanced FLP homepage and add dirty-state separation tests ([#25](https://github.com/wridgeu/ui5-lib-guard-router/issues/25)) ([366e03f](https://github.com/wridgeu/ui5-lib-guard-router/commit/366e03fc42d8b701d7ee87e00e25d01861d3b162))


### Bug Fixes

* prevent stranded settlement on redirect to nonexistent route ([e251b1d](https://github.com/wridgeu/ui5-lib-guard-router/commit/e251b1d227f7fae4835efe25859c8cdc31a7f0f6))
* settle failed redirect as Blocked, not Redirected ([9a9433e](https://github.com/wridgeu/ui5-lib-guard-router/commit/9a9433e22acfce71c77261a17fdb6f7f3453b6eb))


### Code Refactoring

* remove redundant library side-effect import from Router ([1ab6930](https://github.com/wridgeu/ui5-lib-guard-router/commit/1ab693042087f698576f8064c9209b116eeb3b1a))
* **test:** remove redundant library import from QUnit suite ([b671893](https://github.com/wridgeu/ui5-lib-guard-router/commit/b671893a9df2f2bf796d8c1a75350222ddeaf171))

## [1.1.1](https://github.com/wridgeu/ui5-lib-guard-router/compare/v1.1.0...v1.1.1) (2026-03-16)


### Bug Fixes

* bump version to 1.1.1 to skip burned 1.1.0 on npm ([b711a43](https://github.com/wridgeu/ui5-lib-guard-router/commit/b711a4316b21032aa6a6fbf2fe10953d3ddd1f1d))

## [1.1.0](https://github.com/wridgeu/ui5-lib-guard-router/compare/v1.0.2...v1.1.0) (2026-03-16)


### Features

* ship UI5 build manifest, document library consumption ([d5efc52](https://github.com/wridgeu/ui5-lib-guard-router/commit/d5efc523fed093e0d57197e41fb09145e7e7973a))


### Code Refactoring

* typed router class, lifecycle hardening, compat lane ([#20](https://github.com/wridgeu/ui5-lib-guard-router/issues/20)) ([e6f72cb](https://github.com/wridgeu/ui5-lib-guard-router/commit/e6f72cbecfb8c4521a8a86990aae6aa4e3013caa))

## [1.0.2](https://github.com/wridgeu/ui5-lib-guard-router/compare/v1.0.1...v1.0.2) (2026-03-14)


### Bug Fixes

* harden guard runtime handling and packaging ([#17](https://github.com/wridgeu/ui5-lib-guard-router/issues/17)) ([1023ee8](https://github.com/wridgeu/ui5-lib-guard-router/commit/1023ee867e6dfd57cd013e281602cf4f42842dfc))

## [1.0.1](https://github.com/wridgeu/ui5-lib-guard-router/compare/v1.0.0...v1.0.1) (2026-02-16)


### Bug Fixes

* fix npm trusted publishing for OIDC ([78c5900](https://github.com/wridgeu/ui5-lib-guard-router/commit/78c59007f28a11eead75845e43efdda85e3bdbf6))
* replace deprecated Component.get() and correct Log API usage ([f5a8af0](https://github.com/wridgeu/ui5-lib-guard-router/commit/f5a8af0bfaade1cdd2fc09cc4ccd3df7a07a2dac))

## 1.0.0 (2026-02-15)


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
