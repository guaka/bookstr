import vm from 'node:vm';

export function functionSource(source: string, name: string): string {
  const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const declaration = new RegExp(`^[ \\t]*(?:async\\s+)?function\\s+${escapedName}\\s*\\(`, 'm').exec(source);
  if (!declaration) throw new Error(`Function declaration not found: ${name}`);

  const start = declaration.index;
  for (let index = start; index < source.length; index++) {
    if (source[index] !== '}') continue;
    const candidate = source.slice(start, index + 1);
    try {
      new vm.Script(`(${candidate})`);
      return candidate;
    } catch {
      // Keep scanning until the complete declaration parses.
    }
  }
  throw new Error(`Complete function declaration not found: ${name}`);
}
