# Outside clicks lost while menus open

The historical KVG-4904 investigation below covers Bits UI 2.19.0 with Svelte 5.57.0 and Playwright 1.62.1 Chromium. The behavior reproduces in SDK AnchoredMenu, SplitButton, and a bare Bits UI DropdownMenu without SDK focus handlers or styles.

Upstream report: https://github.com/huntabyte/bits-ui/issues/2141

## Adopted fix

KVG-5307 adopts `bits-ui@2.19.3`, released September 22, 2026. Upstream PR [#2143](https://github.com/huntabyte/bits-ui/pull/2143) registers dismissal listeners synchronously and preserves registration across rerenders and content-ref replacement. The release also includes the synchronous interaction-state reset from PR [#2111](https://github.com/huntabyte/bits-ui/pull/2111). Issue #2141 remained open when the published fix was verified.

The three opening regressions now require dismissal rather than using expected failures. They failed on 2.19.2 and pass on 2.19.3. Native outside-click tests open each control and immediately click outside without treating removal of `data-starting-style` as readiness. The old split-menu readiness wait is not present in this checkout; the new native test makes the requirement explicit.

The upstream public `DropdownMenu.Content` child snippet supplies a deterministic ref-replacement case. A mutation observer dispatches the outside sequence as soon as the replacement node appears. This test fails on 2.19.0 and passes on 2.19.3. A separate public pointerdown callback flushes a same-ref rerender during an outside interaction and checks that it still dismisses once. No library internals, arbitrary sleeps, application dismissal listeners, or duplicate keyboard/focus handling are used.

These lifecycle cases do not separately pin the original 20ms-reset/10ms-handler ordering. The synchronous reset is verified in the published dependency; ref replacement has a deterministic behavioral regression. Version 2.19.4 was available but too recent for this repository's five-day minimum-release-age policy, which was not bypassed.

## Result

An outside click during opening can leave the menu open without selecting anything. A subsequent outside click closes it. This task reports the issue upstream rather than adding competing document listeners or copying menu keyboard/focus behavior. No runtime workaround or dependency patch is shipped.

## Two races

In `bits/utilities/dismissible-layer/use-dismissable-layer.svelte.js`:

1. The enabled/ref watcher defers layer registration and document listeners with `afterSleep(1)`. A click before registration is never captured. Ref changes during opening can cancel the first registration and schedule another.
2. Watcher cleanup schedules `#resetState` through a 20ms debounce. Re-registration does not cancel this reset. An outside pointerdown can mark the layer responsible, then the old reset clears that flag before the 10ms-debounced `#handleInteractOutside` checks it. The handler drops the valid click.

Temporary logging in the installed dependency, removed after investigation, recorded these native `page.mouse.click(900, 10)` sequences. Times are milliseconds from the page's performance clock:

| Event | Registration gap, standalone | Reset race, standalone |
| --- | ---: | ---: |
| Watcher cleanup | 3372.7 | 2244.5 |
| Register listeners | 3375.4 | 2247.3 |
| Outside pointerdown | 3369.4 | 2260.0 |
| Capture listener | Not reached | 2260.1 |
| Delayed reset | 3393.4 | 2273.1 |
| Dismissal handler | Not reached | 2273.2, responsible=false |
| Opening marker at pointerdown | Present | Absent |
| Outcome | Menu stays open | Menu stays open |

The same native-click run lost opening clicks in SplitButton. A native SplitButton click also arrived after the marker disappeared but before listeners registered. These observations are timing-dependent diagnostics, not statistical benchmarks.

`data-starting-style` belongs to PresenceManager. Its removal is scheduled through requestAnimationFrame independently of dismissal readiness. Waiting for that marker to disappear can hide the bug but does not guarantee readiness. Version 2.19.2 still defers listener registration, although 2.19.1 already made the reset synchronous. The historical browser reproduction here used 2.19.0.

## Minimal upstream reproduction

Render this component with `bits-ui@2.19.0` and `svelte@5.57.0`:

```svelte
<script>
  import { DropdownMenu } from 'bits-ui'
</script>

<DropdownMenu.Root>
  <DropdownMenu.Trigger>Actions</DropdownMenu.Trigger>
  <DropdownMenu.Portal>
    <DropdownMenu.Content>
      <DropdownMenu.Item>Action</DropdownMenu.Item>
    </DropdownMenu.Content>
  </DropdownMenu.Portal>
</DropdownMenu.Root>
```

Before opening, run the following in the browser console, then click Actions. The observer dispatches a complete DOM mouse sequence when the public opening marker appears. These are synthetic DOM events in a real browser, chosen to make the registration-gap reproduction deterministic. The native mouse traces above independently confirm the user-visible failure.

```js
function outsideClick() {
  for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']) {
    const EventType = type.startsWith('pointer') ? PointerEvent : MouseEvent
    document.documentElement.dispatchEvent(new EventType(type, {
      bubbles: true, composed: true, cancelable: true,
      clientX: 900, clientY: 10, button: 0,
      buttons: type.endsWith('down') ? 1 : 0,
      pointerType: 'mouse',
    }))
  }
}
const observer = new MutationObserver(() => {
  if (!document.querySelector('[role="menu"][data-starting-style]')) return
  observer.disconnect()
  outsideClick()
})
observer.observe(document.body, { childList: true, subtree: true, attributes: true })
```

Expected: the outside click closes the menu. Actual: the menu stays open. Run `outsideClick()` again after observing the failure; the identical sequence closes it.

For a timing-dependent native reproduction, repeatedly open the trigger with Playwright and immediately call `page.mouse.click(900, 10)`. Record the marker on document pointerdown rather than querying it afterward. The outside coordinate must be outside the menu.

## Regression and follow-up

`packages/plugin-sdk/src/ui/AnchoredMenu.browser.test.ts` runs the deterministic opening case against both SDK controls and the bare Bits UI fixture. Fixture setup, the opening-marker check, no-selection checks, and dismissal assertions are all ordinary assertions. No `.fails` markers remain.

The dismissal assertion polls until its normal deadline. Mutation observers also pin clicks to content-ref replacement, while native mouse checks make no animation-marker readiness assumption. There are no sleeps, mocked library internals, or runtime keyboard/focus changes.

Run:

```sh
pnpm --filter @openforge-app/plugin-sdk test src/ui/AnchoredMenu.browser.test.ts
```

The adopted upstream release fixes listener registration and interaction-state reset. Regression coverage here checks immediate opening dismissal, native outside clicks, ref replacement, and same-ref rerenders alongside the existing keyboard, focus, and publication checks. The historical local experiment removing only the registration timer did not fix the opening regression, so deleting that delay alone was never a verified fix.
