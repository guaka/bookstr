import type { DictionaryEntry, TranslationLanguage, VocabularyWord } from '../types'
import {
  getDictionaryEntry,
  getVocabularyWord,
  saveDictionaryEntry,
  saveVocabularyWord,
} from './catalog'

const CACHE_MAX_AGE = 30 * 24 * 60 * 60 * 1000

export function normalizeSelectedWord(selection: string): string | null {
  const word = selection
    .normalize('NFC')
    .trim()
    .replace(/^\P{L}+|\P{L}+$/gu, '')
    .toLocaleLowerCase()
  if (!word || word.length > 64 || !/^\p{L}+(?:['’-]\p{L}+)*$/u.test(word)) return null
  return word
}

function cleanText(value: string) {
  return value.replace(/\s+/g, ' ').replace(/\[editar\]/gi, '').trim()
}

export function extractSurroundingSentence(text: string, selection: string): string | undefined {
  const normalizedText = cleanText(text)
  const normalizedSelection = cleanText(selection)
  if (!normalizedText || !normalizedSelection) return undefined
  const matchAt = normalizedText.toLocaleLowerCase().indexOf(normalizedSelection.toLocaleLowerCase())
  if (matchAt < 0) return undefined

  const before = normalizedText.slice(0, matchAt)
  const after = normalizedText.slice(matchAt + normalizedSelection.length)
  const previousStop = Math.max(before.lastIndexOf('.'), before.lastIndexOf('!'), before.lastIndexOf('?'), before.lastIndexOf('…'))
  const nextStops = ['.', '!', '?', '…']
    .map((stop) => after.indexOf(stop))
    .filter((index) => index >= 0)
  const nextStop = nextStops.length > 0 ? Math.min(...nextStops) : -1
  const start = previousStop >= 0 ? previousStop + 1 : 0
  const end = nextStop >= 0 ? matchAt + normalizedSelection.length + nextStop + 1 : normalizedText.length
  const sentence = normalizedText.slice(start, end).trim()
  return sentence ? sentence.slice(0, 500) : undefined
}

export function parseWiktionaryHtml(
  html: string,
  language: string,
  translationLanguage: TranslationLanguage = 'en',
) {
  const document = new DOMParser().parseFromString(html, 'text/html')
  const portuguese = language.toLowerCase().startsWith('pt')
  const wantedLanguage = portuguese ? 'português' : 'english'
  const languageHeading = [...document.querySelectorAll<HTMLElement>('h1, h2')].find((heading) =>
    cleanText(heading.textContent ?? '').toLocaleLowerCase().includes(wantedLanguage),
  )
  const headingRow = languageHeading?.parentElement
  if (!languageHeading || !headingRow) return { definitions: [] as string[] }

  const levelClass = [...headingRow.classList].find((name) => /^mw-heading\d$/.test(name))
  const nodes: Element[] = []
  let sibling = headingRow.nextElementSibling
  while (sibling) {
    if (levelClass && sibling.classList.contains(levelClass)) break
    nodes.push(sibling)
    sibling = sibling.nextElementSibling
  }

  const definitions: string[] = []
  let partOfSpeech: string | undefined
  let translation: string | undefined
  for (const node of nodes) {
    const heading = node.matches('.mw-heading') ? node.querySelector('h2, h3, h4') : null
    if (!partOfSpeech && heading) {
      const candidate = cleanText(heading.textContent ?? '')
      if (!/^(Etimologia|Pronúncia|Ver também|Etymology|Pronunciation)$/i.test(candidate)) {
        partOfSpeech = candidate
      }
    }
    for (const item of node.querySelectorAll('ol > li')) {
      const text = cleanText(item.textContent ?? '')
      if (text && !definitions.includes(text)) definitions.push(text)
      if (definitions.length >= 4) break
    }
    const translationLabel = translationLanguage === 'pt' ? 'Portugu(?:ese|ês)' : 'Inglês'
    const translationPattern = new RegExp(`^${translationLabel}\\s*:\\s*(.+)$`, 'i')
    for (const item of node.querySelectorAll('li')) {
      const match = cleanText(item.textContent ?? '').match(translationPattern)
      if (match?.[1]) {
        translation = match[1]
        break
      }
    }
  }

  return { definitions: definitions.slice(0, 4), partOfSpeech, translation }
}

export async function lookupWord(
  selection: string,
  language: string,
  translationLanguage: TranslationLanguage = 'en',
): Promise<DictionaryEntry> {
  const word = normalizeSelectedWord(selection)
  if (!word) throw new Error('Select one word')
  const dictionaryLanguage = language.toLowerCase().startsWith('pt') ? 'pt' : 'en'
  const key = `${dictionaryLanguage}:${translationLanguage}:${word}`
  const cached = await getDictionaryEntry(key)
  if (cached && Date.now() - cached.updatedAt < CACHE_MAX_AGE) return cached

  const host = dictionaryLanguage === 'pt' ? 'pt.wiktionary.org' : 'en.wiktionary.org'
  const params = new URLSearchParams({
    action: 'parse',
    page: word,
    prop: 'text',
    format: 'json',
    formatversion: '2',
    origin: '*',
  })
  const response = await fetch(`https://${host}/w/api.php?${params}`)
  if (!response.ok) throw new Error(`Dictionary HTTP ${response.status}`)
  const payload = (await response.json()) as { parse?: { text?: string } }
  const parsed = parseWiktionaryHtml(payload.parse?.text ?? '', dictionaryLanguage, translationLanguage)
  if (parsed.definitions.length === 0) throw new Error(`No definition found for “${word}”`)

  const entry: DictionaryEntry = {
    key,
    word,
    language: dictionaryLanguage,
    partOfSpeech: parsed.partOfSpeech,
    definitions: parsed.definitions,
    translation: parsed.translation,
    sourceUrl: `https://${host}/wiki/${encodeURIComponent(word)}`,
    updatedAt: Date.now(),
  }
  await saveDictionaryEntry(entry)
  return entry
}

export async function rememberVocabulary(
  entry: DictionaryEntry,
  context: { bookId: string; bookTitle: string; cfi?: string; contextSentence?: string },
  incrementLookup = true,
): Promise<VocabularyWord> {
  const existing = await getVocabularyWord(entry.key)
  const now = Date.now()
  const word: VocabularyWord = {
    ...entry,
    syncId: existing?.syncId ?? crypto.randomUUID(),
    bookId: context.bookId,
    bookTitle: context.bookTitle,
    cfi: context.cfi,
    contextSentence: context.contextSentence,
    lookupCount: (existing?.lookupCount ?? 0) + (incrementLookup ? 1 : 0),
    firstSeenAt: existing?.firstSeenAt ?? now,
    lastSeenAt: now,
    updatedAt: now,
  }
  await saveVocabularyWord(word)
  return word
}
