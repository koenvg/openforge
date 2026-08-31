import { isValidTerminalDimensions } from './terminalGeometry'
import type { TerminalView } from './terminalView'

export { isValidTerminalDimensions }

export function safeFit(view: Pick<TerminalView, 'fit'>): boolean {
  return isValidTerminalDimensions(view.fit())
}
