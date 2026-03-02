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
