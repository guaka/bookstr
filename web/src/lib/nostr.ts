import {
  finalizeEvent,
  generateSecretKey,
  getPublicKey,
  nip19,
  SimplePool,
  type EventTemplate,
} from 'nostr-tools'
import type { ReadingProgress } from '../types'
import { getSetting, listProgress, saveProgress, setSetting } from './catalog'

const KIND = 30078
const D_PREFIX = 'app.bookstr.progress.'

export const DEFAULT_RELAYS = [
  'wss://relay.damus.io',
  'wss://nos.lol',
  'wss://relay.nostr.band',
]

function dTag(bookId: string) {
  return `${D_PREFIX}${bookId}`
}

export async function getNsec(): Promise<string> {
  return getSetting('nsec')
}

export async function setNsec(nsec: string): Promise<string> {
  const trimmed = nsec.trim()
  if (!trimmed) {
    await setSetting('nsec', '')
    await setSetting('npub', '')
    return ''
  }
  let sk: Uint8Array
  if (trimmed.startsWith('nsec')) {
    const decoded = nip19.decode(trimmed)
    if (decoded.type !== 'nsec') throw new Error('Not an nsec')
    sk = decoded.data as Uint8Array
  } else {
    throw new Error('Expected nsec… bech32')
  }
  const npub = nip19.npubEncode(getPublicKey(sk))
  await setSetting('nsec', trimmed)
  await setSetting('npub', npub)
  return npub
}

export async function getNpub(): Promise<string> {
  return getSetting('npub')
}

export async function getRelays(): Promise<string[]> {
  const raw = await getSetting('relays', DEFAULT_RELAYS.join('\n'))
  return raw
    .split(/[\n,]+/)
    .map((r) => r.trim())
    .filter(Boolean)
}

export async function setRelays(text: string): Promise<void> {
  await setSetting('relays', text)
}

function secretFromNsec(nsec: string): Uint8Array {
  const decoded = nip19.decode(nsec)
  if (decoded.type !== 'nsec') throw new Error('Invalid nsec')
  return decoded.data as Uint8Array
}

export async function publishProgress(progress: ReadingProgress): Promise<void> {
  const nsec = await getNsec()
  if (!nsec) return
  const sk = secretFromNsec(nsec)
  const relays = await getRelays()
  const template: EventTemplate = {
    kind: KIND,
    created_at: Math.floor(Date.now() / 1000),
    tags: [['d', dTag(progress.bookId)]],
    content: JSON.stringify(progress),
  }
  const event = finalizeEvent(template, sk)
  const pool = new SimplePool()
  try {
    await Promise.any(pool.publish(relays, event))
  } finally {
    pool.close(relays)
  }
}

export async function pullProgress(): Promise<number> {
  const nsec = await getNsec()
  if (!nsec) return 0
  const sk = secretFromNsec(nsec)
  const pubkey = getPublicKey(sk)
  const relays = await getRelays()
  const pool = new SimplePool()
  let merged = 0
  try {
    const events = await pool.querySync(relays, {
      kinds: [KIND],
      authors: [pubkey],
    })
    for (const ev of events) {
      const d = ev.tags.find((t) => t[0] === 'd')?.[1]
      if (!d?.startsWith(D_PREFIX)) continue
      try {
        const remote = JSON.parse(ev.content) as ReadingProgress
        if (!remote?.bookId || typeof remote.updatedAt !== 'number') continue
        const local = (await listProgress()).find((p) => p.bookId === remote.bookId)
        if (!local || remote.updatedAt > local.updatedAt) {
          await saveProgress(remote)
          merged++
        }
      } catch {
        /* skip bad payload */
      }
    }
  } finally {
    pool.close(relays)
  }
  return merged
}

export function generateDemoNsec(): string {
  return nip19.nsecEncode(generateSecretKey())
}

declare global {
  interface Window {
    nostr?: {
      getPublicKey(): Promise<string>
      signEvent(event: {
        kind: number
        created_at: number
        tags: string[][]
        content: string
      }): Promise<{
        id: string
        pubkey: string
        created_at: number
        kind: number
        tags: string[][]
        content: string
        sig: string
      }>
    }
  }
}

export function hasNip07(): boolean {
  return typeof window !== 'undefined' && !!window.nostr
}
