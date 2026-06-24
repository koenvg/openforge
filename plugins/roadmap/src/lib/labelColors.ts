export const LABEL_SWATCHES = [
  'b60205',
  'd93f0b',
  'fbca04',
  '0e8a16',
  '006b75',
  '1d76db',
  '0052cc',
  '5319e7',
  'e99695',
  'f9d0c4',
  'fef2c0',
  'c2e0c6',
  'bfdadc',
  'c5def5',
  'bfd4f2',
  'd4c5f9',
] as const

const HEX6 = /^[0-9a-fA-F]{6}$/

export function normalizeLabelColor(value: string): string | null {
  const normalized = value.trim().replace(/^#/, '').toLowerCase()
  return HEX6.test(normalized) ? normalized : null
}
