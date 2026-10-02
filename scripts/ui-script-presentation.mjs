const property = node => node?.computed ? node.property?.value : node?.property?.name

// Locate imperative styling sinks separately from literal role/state vocabulary.
export function scriptPresentationInputs(node) {
  if (['ImportDeclaration', 'ExportNamedDeclaration', 'ExportAllDeclaration', 'ImportExpression'].includes(node.type)) {
    return { moduleAssets: [node.source] }
  }
  if (node.type === 'TSExternalModuleReference') return { moduleAssets: [node.expression] }
  if (node.type === 'AssignmentExpression' && property(node.left) === 'className') {
    return { classValue: node.right }
  }
  if (node.type !== 'CallExpression') return null
  const method = property(node.callee)
  if (node.callee?.type === 'Import' || node.callee?.name === 'require'
    || (node.callee?.object?.name === 'require' && method === 'resolve')) {
    return { moduleAssets: node.arguments.slice(0, 1) }
  }
  if (method === 'setAttribute' && node.arguments[0]?.value === 'class') {
    return { classValue: node.arguments[1] }
  }
  if (property(node.callee?.object) === 'classList' && ['add', 'remove', 'toggle', 'replace'].includes(method)) {
    return { classValue: { type: 'ArrayExpression', elements: method === 'toggle' ? node.arguments.slice(0, 1) : node.arguments, start: node.start, end: node.end } }
  }
  if (['readFile', 'readFileSync', 'fetch', 'addStyleTag'].includes(method ?? node.callee?.name)) {
    return { styleAssets: node.arguments }
  }
  return null
}
