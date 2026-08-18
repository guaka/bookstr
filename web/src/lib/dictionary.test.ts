import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { listVocabulary, resetCatalogDbForTests } from './catalog'
import {
  lookupWord,
  normalizeSelectedWord,
  parseWiktionaryHtml,
  rememberVocabulary,
  extractSurroundingSentence,
} from './dictionary'

describe('dictionary', () => {
  beforeEach(async () => {
    await resetCatalogDbForTests()
    vi.restoreAllMocks()
  })

  afterEach(async () => {
    await resetCatalogDbForTests()
  })

  it('accepts one Unicode word and rejects phrases', () => {
    expect(normalizeSelectedWord('  Coração! ')).toBe('coração')
    expect(normalizeSelectedWord("d'água")).toBe("d'água")
    expect(normalizeSelectedWord('duas palavras')).toBeNull()
  })

  it('keeps the surrounding sentence as learning context', () => {
    expect(
      extractSurroundingSentence(
        'Uma frase anterior. O coração bombeia sangue pelo corpo. Outra frase depois!',
        'coração',
      ),
    ).toBe('O coração bombeia sangue pelo corpo.')
  })

  it('extracts Portuguese definitions and an English translation', () => {
    const html = `
      <div class="mw-heading mw-heading1"><h1 id="Português">Português</h1></div>
      <div class="mw-heading mw-heading2"><h2>Substantivo</h2></div>
      <ol><li>órgão que bombeia sangue</li><li>centro dos sentimentos</li></ol>
      <ul><li>Inglês: heart</li></ul>
    `
    expect(parseWiktionaryHtml(html, 'pt')).toEqual({
      partOfSpeech: 'Substantivo',
      definitions: ['órgão que bombeia sangue', 'centro dos sentimentos'],
      translation: 'heart',
    })
  })

  it('caches a lookup and remembers its reading context', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            parse: {
              text: '<div class="mw-heading mw-heading1"><h1 id="Português">Português</h1></div><div class="mw-heading mw-heading2"><h2>Substantivo</h2></div><ol><li>uma definição</li></ol>',
            },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      ),
    )

    const entry = await lookupWord('Palavra', 'pt-BR')
    const saved = await rememberVocabulary(entry, {
      bookId: 'book-1',
      bookTitle: 'Livro',
      cfi: 'epubcfi(/6/2)',
    })
    expect(saved.word).toBe('palavra')
    expect(saved.bookTitle).toBe('Livro')
    expect(await listVocabulary()).toEqual([saved])

    await lookupWord('palavra', 'pt')
    expect(fetch).toHaveBeenCalledTimes(1)
  })
})
