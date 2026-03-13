import { commandHeld } from './stores'

export function setupCommandHeldListeners() {
  let showTimer: ReturnType<typeof setTimeout> | null = null

  function onKeyDown(e: KeyboardEvent) {
    if (e.key !== 'Meta') return
    if (e.repeat) return
    clearTimeout(showTimer!)
    showTimer = setTimeout(() => {
      commandHeld.set(true)
    }, 150)
  }

  function onKeyUp(e: KeyboardEvent) {
    if (e.key !== 'Meta') return
    clearTimeout(showTimer!)
    showTimer = null
    commandHeld.set(false)
  }

  function onBlur() {
    clearTimeout(showTimer!)
    showTimer = null
    commandHeld.set(false)
  }

  function onVisibilityChange() {
    if (document.hidden) {
      clearTimeout(showTimer!)
      showTimer = null
      commandHeld.set(false)
    }
  }

  window.addEventListener('keydown', onKeyDown)
  window.addEventListener('keyup', onKeyUp)
  window.addEventListener('blur', onBlur)
  document.addEventListener('visibilitychange', onVisibilityChange)

  return () => {
    clearTimeout(showTimer!)
    window.removeEventListener('keydown', onKeyDown)
    window.removeEventListener('keyup', onKeyUp)
    window.removeEventListener('blur', onBlur)
    document.removeEventListener('visibilitychange', onVisibilityChange)
    commandHeld.set(false)
  }
}

export function useCommandHeld() {
  $effect(() => {
    return setupCommandHeldListeners()
  })
}
