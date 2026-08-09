import { describe, expect, it } from 'vitest'
import { resolveCatalogUrl, sha256Hex } from './catalog'
import { normalizeProgress, progressDTag } from './progress'

describe('sha256Hex', () => {
  it('hashes UTF-8 bytes to known digests', async () => {
    const empty = await sha256Hex(new TextEncoder().encode('').buffer)
    expect(empty).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855')

    const abc = await sha256Hex(new TextEncoder().encode('abc').buffer)
    expect(abc).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
  })
})

describe('resolveCatalogUrl', () => {
  it('resolves relative epub paths against the catalog URL', () => {
    expect(
      resolveCatalogUrl('https://books.example.org/catalog.json', './books/ab.epub'),
    ).toBe('https://books.example.org/books/ab.epub')
  })

  it('keeps absolute epub URLs', () => {
    expect(
      resolveCatalogUrl('https://books.example.org/catalog.json', 'https://cdn.example.org/x.epub'),
    ).toBe('https://cdn.example.org/x.epub')
  })
})

describe('progressDTag', () => {
  it('prefixes book ids', () => {
    expect(progressDTag('deadbeef')).toBe('app.bookstr.progress.deadbeef')
  })
})

describe('normalizeProgress', () => {
  const bookId = 'afea92e35940157a01537f5d064d4b9ff9985ab8ae4719985001238f1de45c2b'

  it('parses v1 locator payloads', () => {
    const remote = normalizeProgress(
      {
        v: 1,
        bookId,
        title: 'Little Brother',
        locator: { progression: 0.42, cfi: 'epubcfi(/6/4)', href: 'ch1.xhtml' },
        updatedAt: 1_700_000_000_000,
      },
      'fallback',
      1_700_000_001,
    )
    expect(remote).toEqual({
      v: 1,
      bookId,
      title: 'Little Brother',
      author: undefined,
      locator: { href: 'ch1.xhtml', progression: 0.42, cfi: 'epubcfi(/6/4)' },
      updatedAt: 1_700_000_000_000,
    })
  })

  it('falls back to d-tag bookId and event time', () => {
    const remote = normalizeProgress(
      { locator: { progression: 0.1 } },
      bookId,
      1_700_000_001,
    )
    expect(remote?.bookId).toBe(bookId)
    expect(remote?.updatedAt).toBe(1_700_000_001_000)
  })

  it('accepts legacy flat Android payloads', () => {
    const remote = normalizeProgress(
      { progression: 0.55, cfi: 'epubcfi(/6/8)' },
      bookId,
      1_700_000_002,
    )
    expect(remote).toEqual({
      v: 1,
      bookId,
      locator: { progression: 0.55, cfi: 'epubcfi(/6/8)' },
      updatedAt: 1_700_000_002_000,
    })
  })

  it('rejects garbage', () => {
    expect(normalizeProgress({ hello: 'world' }, bookId, 1)).toBeNull()
  })
})
