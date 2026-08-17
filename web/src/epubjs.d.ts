declare module 'epubjs' {
  export interface Location {
    start?: { cfi?: string; href?: string; percentage?: number }
  }

  export interface Rendition {
    display(target?: string): Promise<void>
    next(): Promise<void>
    prev(): Promise<void>
    destroy(): void
    on(event: string, fn: (...args: unknown[]) => void): void
    themes: {
      register(name: string, styles: Record<string, Record<string, string>>): void
      select(name: string): void
    }
    currentLocation(): Location
  }

  export interface Book {
    renderTo(
      element: HTMLElement,
      options?: Record<string, unknown>,
    ): Rendition
    destroy(): void
  }

  export default function ePub(input: string | ArrayBuffer): Book
}
