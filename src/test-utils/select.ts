import { fireEvent, screen } from '@testing-library/svelte'

/** Operate a public Select by accessible trigger and option names. */
export async function openSelect(trigger: HTMLElement): Promise<void> {
  if (trigger.getAttribute('aria-expanded') !== 'true') {
    await fireEvent.keyDown(trigger, { key: 'ArrowDown' })
  }
}

export async function chooseSelectOption(trigger: HTMLElement, name: string | RegExp): Promise<void> {
  await openSelect(trigger)
  await fireEvent.pointerUp(screen.getByRole('option', { name }), { button: 0 })
}
