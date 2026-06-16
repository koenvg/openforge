class TestLocalStorage implements Storage {
  private readonly store = new Map<string, string>()

  get length() {
    return this.store.size
  }

  clear() {
    this.store.clear()
  }

  getItem(key: string) {
    return this.store.has(key) ? this.store.get(key)! : null
  }

  key(index: number) {
    return Array.from(this.store.keys())[index] ?? null
  }

  removeItem(key: string) {
    this.store.delete(key)
  }

  setItem(key: string, value: string) {
    this.store.set(key, String(value))
  }
}

if (
  typeof globalThis.localStorage?.getItem !== 'function' ||
  typeof globalThis.localStorage?.setItem !== 'function' ||
  typeof globalThis.localStorage?.clear !== 'function' ||
  !(globalThis.localStorage instanceof Storage)
) {
  Object.defineProperty(globalThis, 'Storage', {
    configurable: true,
    value: TestLocalStorage,
  })
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: new TestLocalStorage(),
  })
}

class MockWorker {
  onmessage: ((ev: MessageEvent) => void) | null = null
  onerror: ((ev: ErrorEvent) => void) | null = null

  postMessage(_data: unknown): void {}
  terminate(): void {}
  addEventListener(): void {}
  removeEventListener(): void {}
  dispatchEvent(): boolean { return false }
}

globalThis.Worker = MockWorker as unknown as typeof Worker

if (typeof HTMLCanvasElement !== 'undefined') {
  Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', {
    value: function getContext(this: HTMLCanvasElement, contextId: string) {
      if (contextId !== '2d') return null

      return {
        canvas: this,
        font: '',
        measureText: (text: string) => ({ width: text.length * 7 }) as TextMetrics,
        fillText: () => {},
        clearRect: () => {},
      } as unknown as CanvasRenderingContext2D
    },
    configurable: true,
    writable: true,
  })
}
