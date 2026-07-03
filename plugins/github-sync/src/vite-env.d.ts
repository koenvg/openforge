/// <reference types="vite/client" />

// Raw text imports (e.g. `import tpl from './foo.md?raw'`) resolve to a string.
declare module '*?raw' {
  const content: string
  export default content
}
