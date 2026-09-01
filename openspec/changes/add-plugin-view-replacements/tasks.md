## 1. Public plugin contract

- [ ] 1.1 Add failing plugin SDK tests for the `viewReplacements` capability, the two supported targets, their target-specific props, registration typing, and frontend API exposure; verify the focused SDK tests fail for the missing contract.
- [ ] 1.2 Implement the package metadata schema, public types, frontend exports, and `openforge.viewReplacements.register(...)` interface; verify the focused SDK type and metadata tests pass.
- [ ] 1.3 Extend the SDK testing fake, entrypoint registries, authoring fixture, and published-contract fixture for replacement contributions; verify `pnpm --filter @openforge-app/plugin-sdk build` and `pnpm packages:contract:check` pass.

## 2. Runtime contribution lifecycle

- [ ] 2.1 Add failing runtime tests for valid replacement registration, unsupported targets, missing capability, duplicate qualified claims, separation from additive Views, and activation rollback; verify the focused runtime contribution tests fail before implementation.
- [ ] 2.2 Implement replacement contribution registration, snapshots, resolution, component registration, and render-prop projection in the frontend plugin runtime; verify the focused registration and contribution resolver tests pass.
- [ ] 2.3 Add lifecycle tests for reload, deactivation, uninstall, project enablement changes, and component cleanup; implement the required teardown and verify no stale replacement remains registered after each lifecycle transition.

## 3. Provider preferences and resolution

- [ ] 3.1 Add failing unit tests for global defaults, project inheritance, explicit core overrides, project plugin overrides, target mismatches, unavailable qualified IDs, and provider return; verify the resolver tests fail before implementation.
- [ ] 3.2 Implement typed preference parsing, serialization, persistence keys, and effective-provider resolution without rewriting unavailable selections; verify the resolver and persistence tests pass.
- [ ] 3.3 Add reactive integration tests for project activation and contribution refresh races; implement recomputation so the core provider renders during absence and the selected plugin resumes when available.

## 4. Project dashboard replacement

- [x] 4.1 Add characterization tests for the core Focus Board route, selected-task precedence, dashboard shortcut, project restoration, attention metadata, and repeat invocation before introducing the provider wrapper; verify the tests pass against current behavior.
- [ ] 4.2 Add failing component tests for plugin dashboard props, title and icon projection, core selection, unavailable-provider fallback, loader failure, render failure, and recovery navigation; verify the tests fail before implementation.
- [ ] 4.3 Implement the host-owned project dashboard wrapper and error boundary, using logical project and provider identity for mount and teardown; verify the dashboard replacement component tests pass.
- [ ] 4.4 Integrate the effective dashboard provider into `App.svelte`, icon-rail presentation, shortcut help, and router invocation behavior while keeping the internal `board` destination stable; verify existing app navigation and icon-rail tests plus the new replacement tests pass.
- [ ] 4.5 Add integration tests for opening a task from a plugin dashboard and navigating back; verify task selection, history, and the previous dashboard provider are restored correctly.

## 5. Task detail replacement

- [ ] 5.1 Add failing SDK and component tests for typed task detail props, related-task data, `on`-prefixed edit, actions, refresh, and task-navigation callbacks; verify the tests fail before implementation.
- [ ] 5.2 Implement the host-owned task detail wrapper, target-specific render props, and local core fallback for load and render failures; verify focused task replacement tests pass.
- [ ] 5.3 Integrate task provider resolution into the selected-task branch without changing selected-task or route ownership; verify existing `TaskDetailView` navigation, edit, action, and refresh tests remain green.
- [ ] 5.4 Add lifecycle tests that switch task, project, provider, plugin enablement, and route while a replacement is mounted; verify teardown follows logical identity and does not release or duplicate host-owned terminal, agent-session, or browser resources.

## 6. Typed task invalidation

- [ ] 6.1 Add failing SDK and testing-fake tests for `TasksAPI.onDidChange`, project filtering, typed reasons, explicit disposal, and lifecycle disposal; verify the focused SDK tests fail before implementation.
- [ ] 6.2 Implement per-plugin task invalidation subscriptions in the renderer plugin host with project filtering, coalescible delivery, and cleanup on deactivation or uninstall; verify focused subscription and lifecycle tests pass.
- [ ] 6.3 Connect host-observed task creation, update, completion, attention, and execution changes to invalidation delivery after accepted state changes; verify focused orchestrator and desktop-event tests cover every reason without exposing raw stores or IPC event names.
- [ ] 6.4 Run `pnpm electron:contract:check` and update generated desktop contract artifacts only if the invalidation bridge changes the desktop IPC registry; verify the check passes with no stale generated output.

## 7. Settings and recovery

- [ ] 7.1 Add failing settings-model and component tests for global provider defaults, project inherit and core choices, compatible provider lists, unavailable stored providers, and unchanged choices after plugin activation; verify the focused settings tests fail before implementation.
- [ ] 7.2 Implement global default selectors and persistence for project dashboard and task detail providers; verify global settings tests pass.
- [ ] 7.3 Implement per-project inherit, core, and plugin override selectors with unavailable-provider messaging; verify project settings and persistence tests pass.
- [ ] 7.4 Add integration tests that trigger a replacement load or render failure and then open global plugin controls; verify users can still disable or uninstall the failing plugin and the core renderer remains usable.

## 8. Plugin authoring documentation

- [ ] 8.1 Document replacement registration, required capability metadata, target-specific props, user-controlled selection, fallback semantics, and task invalidation subscriptions in `docs/plugin-authoring.md`; verify every code example compiles through the SDK authoring-contract fixture.
- [ ] 8.2 Add test fixtures for one dashboard replacement and one task detail replacement, including task invalidation cleanup; verify the plugin runtime integration tests render both fixtures and existing rail and sidebar View fixtures remain unchanged.

## 9. Affected-system validation

- [ ] 9.1 Run `pnpm test` and fix failures across the renderer, plugin SDK, built-in plugins, and shared package suites; verify the full frontend test command exits successfully.
- [ ] 9.2 Run `pnpm exec tsc --noEmit`, `pnpm lint`, `pnpm --filter @openforge-app/plugin-sdk build`, and `pnpm packages:contract:check`; verify all static, package, and published-contract checks exit successfully.
- [ ] 9.3 Review the completed diff for replacement-target scope, fallback coverage, host-owned resource boundaries, generated-file cleanliness, and accidental changes to existing View behavior; record any remaining validation gap before marking the change complete.
