import { readFileSync } from 'node:fs'

const contractUrl = new URL('../config/openforge-http-bridge-ports.json', import.meta.url)

export function loadHttpBridgePortContract() {
  const contract = JSON.parse(readFileSync(contractUrl, 'utf8'))
  validatePortContract(contract)
  return contract
}

function validatePort(value, name) {
  if (!Number.isInteger(value) || value <= 0 || value > 65535) {
    throw new Error(`${name} must be an integer TCP port between 1 and 65535`)
  }
}

export function validatePortContract(contract) {
  validatePort(contract.productionDefaultPort, 'productionDefaultPort')
  validatePort(contract.developmentDefaultPort, 'developmentDefaultPort')
  return contract
}

export const HTTP_BRIDGE_PORT_CONTRACT = loadHttpBridgePortContract()
export const DEFAULT_HTTP_BRIDGE_PORT = HTTP_BRIDGE_PORT_CONTRACT.productionDefaultPort
export const DEFAULT_HTTP_BRIDGE_PORT_STRING = String(DEFAULT_HTTP_BRIDGE_PORT)
export const DEFAULT_DEV_HTTP_BRIDGE_PORT = HTTP_BRIDGE_PORT_CONTRACT.developmentDefaultPort
