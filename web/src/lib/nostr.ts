import {
  finalizeEvent,
  getPublicKey,
  nip19,
  SimplePool,
  type EventTemplate,
  type VerifiedEvent,
} from 'nostr-tools'
import type { ReadingProgress } from '../types'
import { getSetting, listProgress, saveProgress, setSetting } from './catalog'
import { normalizeProgress, progressDTag } from './progress'

const KIND = 30078
const D_PREFIX = 'app.bookstr.progress.'

export const DEFAULT_RELAYS = [
  'wss://relay.damus.io',
  'wss://nos.lol',
  'wss://relay.nostr.band',
]

export type AuthMode = 'nip07' | 'nsec' | 'none'

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

function dTag(bookId: string) {
  return progressDTag(bookId)
}

export function hasNip07(): boolean {
  return typeof window !== 'undefined' && typeof window.nostr?.getPublicKey === 'function'
}

/** Wait briefly for extensions that inject after page load. */
export async function waitForNip07(timeoutMs = 800): Promise<boolean> {
  if (hasNip07()) return true
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    await new Promise((r) => setTimeout(r, 50))
    if (hasNip07()) return true
  }
  return hasNip07()
}

export async function getNsec(): Promise<string> {
  return getSetting('nsec')
}

export async function getNpub(): Promise<string> {
  return getSetting('npub')
}

export async function getAuthMode(): Promise<AuthMode> {
  const mode = await getSetting('authMode')
  if (mode === 'nip07' || mode === 'nsec') return mode
  return 'none'
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

function hexToNpub(pubkeyHex: string): string {
  return nip19.npubEncode(pubkeyHex)
}

function secretFromNsec(nsec: string): Uint8Array {
  const decoded = nip19.decode(nsec)
  if (decoded.type !== 'nsec') throw new Error('Invalid nsec')
  return decoded.data as Uint8Array
}

/** Prefer NIP-07; only store nsec when the user explicitly pastes one. */
export async function connectNip07(): Promise<{ npub: string; mode: AuthMode }> {
  const ok = await waitForNip07()
  if (!ok || !window.nostr) throw new Error('No NIP-07 extension found')
  const pubkey = await window.nostr.getPublicKey()
  const npub = hexToNpub(pubkey)
  await setSetting('authMode', 'nip07')
  await setSetting('npub', npub)
  // Do not keep a pasted nsec when using the extension
  await setSetting('nsec', '')
  return { npub, mode: 'nip07' }
}

export async function setNsec(nsec: string): Promise<string> {
  const trimmed = nsec.trim()
  if (!trimmed) {
    await setSetting('nsec', '')
    await setSetting('npub', '')
    await setSetting('authMode', 'none')
    return ''
  }
  if (!trimmed.startsWith('nsec')) throw new Error('Expected nsec… bech32')
  const sk = secretFromNsec(trimmed)
  const npub = nip19.npubEncode(getPublicKey(sk))
  await setSetting('nsec', trimmed)
  await setSetting('npub', npub)
  await setSetting('authMode', 'nsec')
  return npub
}

export async function clearIdentity(): Promise<void> {
  await setSetting('nsec', '')
  await setSetting('npub', '')
  await setSetting('authMode', 'none')
}

/** Resolve active pubkey for the configured auth mode only (no surprise prompts). */
export async function resolvePubkey(): Promise<string | null> {
  const mode = await getAuthMode()
  const nsec = await getNsec()

  if (mode === 'nip07' && hasNip07()) {
    try {
      const { npub } = await connectNip07()
      const decoded = nip19.decode(npub)
      if (decoded.type !== 'npub') return null
      return decoded.data as string
    } catch {
      return null
    }
  }

  if (mode === 'nsec' && nsec) {
    return getPublicKey(secretFromNsec(nsec))
  }

  // Legacy: nsec stored without authMode
  if (nsec && mode === 'none') {
    return getPublicKey(secretFromNsec(nsec))
  }

  return null
}

async function signTemplate(template: EventTemplate): Promise<VerifiedEvent> {
  const mode = await getAuthMode()
  const nsec = await getNsec()

  if (mode === 'nip07' && hasNip07()) {
    if (!window.nostr) throw new Error('NIP-07 unavailable')
    await connectNip07()
    const signed = await window.nostr.signEvent(template)
    return signed as VerifiedEvent
  }

  if (!nsec) throw new Error('No Nostr identity')
  return finalizeEvent(template, secretFromNsec(nsec))
}

export async function publishProgress(progress: ReadingProgress): Promise<void> {
  const pubkey = await resolvePubkey()
  if (!pubkey) return

  const relays = await getRelays()
  const template: EventTemplate = {
    kind: KIND,
    created_at: Math.floor(Date.now() / 1000),
    tags: [['d', dTag(progress.bookId)]],
    content: JSON.stringify(progress),
  }
  const event = await signTemplate(template)
  const pool = new SimplePool()
  try {
    await Promise.any(pool.publish(relays, event))
  } finally {
    pool.close(relays)
  }
}

export async function pullProgress(): Promise<number> {
  const pubkey = await resolvePubkey()
  if (!pubkey) return 0

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
        const bookId = d.slice(D_PREFIX.length)
        const raw = JSON.parse(ev.content) as Record<string, unknown>
        const remote = normalizeProgress(raw, bookId, ev.created_at)
        if (!remote) continue
        const local = (await listProgress()).find((p) => p.bookId === remote.bookId)
        if (!local || remote.updatedAt > local.updatedAt) {
          await saveProgress(remote)
          merged++
        }
      } catch {
        /* skip */
      }
    }
  } finally {
    pool.close(relays)
  }
  return merged
}
