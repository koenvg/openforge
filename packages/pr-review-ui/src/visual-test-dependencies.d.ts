declare module '*.css'

declare module '*?raw' {
  const content: string
  export default content
}

declare module 'pngjs' {
  export class PNG {
    width: number
    height: number
    data: Buffer

    constructor(options: { width: number; height: number })

    static sync: {
      read(buffer: Buffer): PNG
      write(png: PNG): Buffer
    }
  }
}
