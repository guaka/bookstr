import '@testing-library/jest-dom/vitest'
import { Blob as NodeBlob } from 'node:buffer'

// happy-dom's Blob is not supported by Node's structuredClone, which
// fake-indexeddb uses when persisting values. Use Node's Blob so cached EPUBs
// behave like browser IndexedDB values in tests.
Object.defineProperty(globalThis, 'Blob', {
  configurable: true,
  writable: true,
  value: NodeBlob,
})
