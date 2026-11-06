export function importWebRuntime(relativePath: string): Promise<unknown> {
  return import(new URL(relativePath, import.meta.url).href);
}
