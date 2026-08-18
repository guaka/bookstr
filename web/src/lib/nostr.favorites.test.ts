import { describe, expect, it } from 'vitest'
import { matchSharedFavorites, parseSharedFavoriteTags } from './nostr'

describe('shared LibVault favorites', () => {
  it('parses the encrypted NIP-51 tag format from LibVault', () => {
    const refs = parseSharedFavoriteTags([
      ['r', 'https://lib.b.bfr.ee/#book?md5=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'],
      ['libvault', 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'],
      ['i', 'isbn:978-0-123456-78-9', 'https://lib.b.bfr.ee/#book?md5=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'],
      ['k', 'isbn'],
    ])

    expect(refs).toEqual([
      {
        libvaultMd5: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        isbn: '9780123456789',
        url: 'https://lib.b.bfr.ee/#book?md5=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      },
    ])
  })

  it('matches portable ISBNs and keeps unmatched LibVault editions visible', () => {
    const refs = parseSharedFavoriteTags([
      ['libvault', 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'],
      ['i', 'isbn:9780123456789'],
      ['r', 'https://lib.b.bfr.ee/#book?md5=bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'],
      ['libvault', 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'],
    ])
    const result = matchSharedFavorites(refs, [
      { id: 'book-1', title: 'One', author: 'Author', isbn: '978-0-123456-78-9', epubUrl: 'one.epub' },
    ])

    expect(result.bookIds).toEqual(['book-1'])
    expect(result.external).toHaveLength(1)
    expect(result.external[0].libvaultMd5).toBe('bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb')
  })
})
