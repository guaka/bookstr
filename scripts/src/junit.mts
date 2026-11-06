function number(value: string | undefined): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function parseJUnit(documents: string[]) {
  const result = { tests: 0, passed: 0, failed: 0, skipped: 0, durationMs: 0 };
  for (const document of documents) {
    const suite = document.match(/<testsuite\s+([^>]+)>/i)?.[1] || '';
    const attribute = (name: string) => suite.match(new RegExp(`${name}="([^"]+)"`, 'i'))?.[1];
    const tests = number(attribute('tests'));
    const failed = number(attribute('failures')) + number(attribute('errors'));
    const skipped = number(attribute('skipped'));
    result.tests += tests;
    result.failed += failed;
    result.skipped += skipped;
    result.passed += Math.max(0, tests - failed - skipped);
    result.durationMs += number(attribute('time')) * 1000;
  }
  return result;
}
