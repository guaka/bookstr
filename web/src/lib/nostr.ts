import {
  finalizeEvent,
  generateSecretKey,
  getPublicKey,
  nip19,
  SimplePool,
  type EventTemplate,
  type VerifiedEvent,
} from 'nostr-tools'
import {
  BunkerSigner,
  createNostrConnectURI,
  parseBunkerInput,
  toBunkerURL,
} from 'nostr-tools/nip46'
import QRCode from 'qrcode'
import type { ReadingProgress } from '../types'
import { getSetting, listProgress, saveProgress, setSetting } from './catalog'
import { normalizeProgress, progressDTag } from './progress'

const KIND = 30078
const D_PREFIX = 'app.bookstr.progress.'

export const DEFAULT_RELAYS = ['wss://relay.nomadwiki.org']

export type AuthMode = 'nip07' | 'nip46' | 'nsec' | 'none'

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
  if (mode === 'nip07' || mode === 'nip46' || mode === 'nsec') return mode
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

function randomConnectSecret(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(8))
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')
}

/** Permissions requested from remote signers (Amber, etc.). */
export const NIP46_PERMS = [`sign_event:${KIND}`, 'get_public_key'] as const

export function buildNostrConnectUri(params: {
  clientPubkey: string
  relays: string[]
  secret: string
  name?: string
  url?: string
}): string {
  return createNostrConnectURI({
    clientPubkey: params.clientPubkey,
    relays: params.relays,
    secret: params.secret,
    perms: [...NIP46_PERMS],
    name: params.name ?? 'bookstr',
    url: params.url,
  })
}

let bunkerSigner: BunkerSigner | null = null
let bunkerPool: SimplePool | null = null
let bunkerRelays: string[] = []

async function closeBunker(): Promise<void> {
  if (bunkerSigner) {
    try {
      await bunkerSigner.close()
    } catch {
      /* ignore */
    }
    bunkerSigner = null
  }
  if (bunkerPool) {
    try {
      bunkerPool.close(bunkerRelays)
    } catch {
      /* ignore */
    }
    bunkerPool = null
    bunkerRelays = []
  }
}

async function persistNip46(signer: BunkerSigner, clientSk: Uint8Array): Promise<string> {
  const pubkey = await signer.getPublicKey()
  const npub = hexToNpub(pubkey)
  await setSetting('nip46ClientNsec', nip19.nsecEncode(clientSk))
  await setSetting('bunkerUrl', toBunkerURL(signer.bp))
  await setSetting('npub', npub)
  await setSetting('nsec', '')
  await setSetting('authMode', 'nip46')
  return npub
}

async function getBunkerSigner(): Promise<BunkerSigner | null> {
  if (bunkerSigner) return bunkerSigner
  const mode = await getAuthMode()
  if (mode !== 'nip46') return null

  const clientNsec = await getSetting('nip46ClientNsec')
  const bunkerUrl = await getSetting('bunkerUrl')
  if (!clientNsec || !bunkerUrl) return null

  const bp = await parseBunkerInput(bunkerUrl)
  if (!bp) throw new Error('Stored bunker URL is invalid')

  const pool = new SimplePool()
  const signer = BunkerSigner.fromBunker(secretFromNsec(clientNsec), bp, { pool })
  bunkerSigner = signer
  bunkerPool = pool
  bunkerRelays = bp.relays.length > 0 ? bp.relays : await getRelays()
  return signer
}

/** Prefer NIP-07; only store nsec when the user explicitly pastes one. */
export async function connectNip07(): Promise<{ npub: string; mode: AuthMode }> {
  const ok = await waitForNip07()
  if (!ok || !window.nostr) throw new Error('No NIP-07 extension found')
  await closeBunker()
  const pubkey = await window.nostr.getPublicKey()
  const npub = hexToNpub(pubkey)
  await setSetting('authMode', 'nip07')
  await setSetting('npub', npub)
  await setSetting('nsec', '')
  await setSetting('nip46ClientNsec', '')
  await setSetting('bunkerUrl', '')
  return { npub, mode: 'nip07' }
}

export type Nip46QrSession = {
  uri: string
  qrDataUrl: string
  cancel: () => void
  done: Promise<{ npub: string; mode: AuthMode }>
}

/**
 * Client-initiated NIP-46 connect: show `qrDataUrl` / `uri` for Amber to scan,
 * then await `done` (or call `cancel`).
 */
export async function startNip46QrConnect(timeoutMs = 300_000): Promise<Nip46QrSession> {
  await closeBunker()
  const relays = await getRelays()
  if (relays.length === 0) throw new Error('Add at least one relay before connecting')

  const clientSk = generateSecretKey()
  const secret = randomConnectSecret()
  const uri = buildNostrConnectUri({
    clientPubkey: getPublicKey(clientSk),
    relays,
    secret,
    url: typeof window !== 'undefined' ? window.location.origin : undefined,
  })
  const qrDataUrl = await QRCode.toDataURL(uri, {
    errorCorrectionLevel: 'M',
    margin: 1,
    width: 280,
    color: { dark: '#1c1916', light: '#fffaf2' },
  })

  const pool = new SimplePool()
  const ac = new AbortController()
  const timer = setTimeout(() => ac.abort(), timeoutMs)

  const done = (async () => {
    try {
      const signer = await BunkerSigner.fromURI(clientSk, uri, { pool }, ac.signal)
      bunkerSigner = signer
      bunkerPool = pool
      bunkerRelays = relays
      const npub = await persistNip46(signer, clientSk)
      return { npub, mode: 'nip46' as AuthMode }
    } catch (e) {
      try {
        pool.close(relays)
      } catch {
        /* ignore */
      }
      if (ac.signal.aborted) throw new Error('NIP-46 connect cancelled or timed out')
      throw e instanceof Error ? e : new Error(String(e))
    } finally {
      clearTimeout(timer)
    }
  })()

  return {
    uri,
    qrDataUrl,
    cancel: () => ac.abort(),
    done,
  }
}

/** Bunker-initiated connect: paste `bunker://…` or a NIP-05 bunker identifier. */
export async function connectBunkerInput(input: string): Promise<{ npub: string; mode: AuthMode }> {
  const trimmed = input.trim()
  if (!trimmed) throw new Error('Paste a bunker:// URI or bunker NIP-05')
  const bp = await parseBunkerInput(trimmed)
  if (!bp) throw new Error('Invalid bunker URI or NIP-05')

  await closeBunker()
  const clientSk = generateSecretKey()
  const pool = new SimplePool()
  const relays = bp.relays.length > 0 ? bp.relays : await getRelays()
  const signer = BunkerSigner.fromBunker(clientSk, bp, { pool })
  try {
    await signer.connect({
      name: 'bookstr',
      url: typeof window !== 'undefined' ? window.location.origin : undefined,
    })
    bunkerSigner = signer
    bunkerPool = pool
    bunkerRelays = relays
    const npub = await persistNip46(signer, clientSk)
    return { npub, mode: 'nip46' }
  } catch (e) {
    try {
      pool.close(relays)
    } catch {
      /* ignore */
    }
    throw e instanceof Error ? e : new Error(String(e))
  }
}

/** Rehydrate a stored NIP-46 session after reload. */
export async function restoreNip46(): Promise<{ npub: string; mode: AuthMode } | null> {
  if ((await getAuthMode()) !== 'nip46') return null
  const signer = await getBunkerSigner()
  if (!signer) return null
  const pubkey = await signer.getPublicKey()
  const npub = hexToNpub(pubkey)
  await setSetting('npub', npub)
  return { npub, mode: 'nip46' }
}

/** Prefer an injected browser signer, then restore the previously selected remote signer. */
export async function restorePreferredIdentity(): Promise<{
  npub: string
  mode: AuthMode
} | null> {
  const mode = await getAuthMode()
  if (await waitForNip07()) {
    try {
      return await connectNip07()
    } catch {
      // If the extension declines or is unavailable, preserve the configured fallback.
    }
  }
  return mode === 'nip46' ? restoreNip46() : null
}

export async function setNsec(nsec: string): Promise<string> {
  const trimmed = nsec.trim()
  if (!trimmed) {
    await clearIdentity()
    return ''
  }
  if (!trimmed.startsWith('nsec')) throw new Error('Expected nsec… bech32')
  await closeBunker()
  const sk = secretFromNsec(trimmed)
  const npub = nip19.npubEncode(getPublicKey(sk))
  await setSetting('nsec', trimmed)
  await setSetting('npub', npub)
  await setSetting('authMode', 'nsec')
  await setSetting('nip46ClientNsec', '')
  await setSetting('bunkerUrl', '')
  return npub
}

export async function clearIdentity(): Promise<void> {
  if (bunkerSigner) {
    try {
      await bunkerSigner.logout()
    } catch {
      /* ignore */
    }
  }
  await closeBunker()
  await setSetting('nsec', '')
  await setSetting('npub', '')
  await setSetting('nip46ClientNsec', '')
  await setSetting('bunkerUrl', '')
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

  if (mode === 'nip46') {
    try {
      const signer = await getBunkerSigner()
      if (!signer) return null
      return await signer.getPublicKey()
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

  if (mode === 'nip46') {
    const signer = await getBunkerSigner()
    if (!signer) throw new Error('NIP-46 bunker not connected')
    return signer.signEvent(template)
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
