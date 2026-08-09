import { describe, expect, it } from 'vitest'
import { buildNostrConnectUri, NIP46_PERMS } from './nostr'

describe('buildNostrConnectUri', () => {
  it('builds a nostrconnect URI with relays, secret, and progress perms', () => {
    const pubkey = 'a'.repeat(64)
    const uri = buildNostrConnectUri({
      clientPubkey: pubkey,
      relays: ['wss://relay.damus.io', 'wss://nos.lol'],
      secret: 'deadbeef',
      name: 'bookstr',
      url: 'https://bookstr.example',
    })

    expect(uri.startsWith(`nostrconnect://${pubkey}?`)).toBe(true)
    const parsed = new URL(uri)
    expect(parsed.protocol).toBe('nostrconnect:')
    expect(parsed.searchParams.get('secret')).toBe('deadbeef')
    expect(parsed.searchParams.getAll('relay')).toEqual([
      'wss://relay.damus.io',
      'wss://nos.lol',
    ])
    expect(parsed.searchParams.get('name')).toBe('bookstr')
    expect(parsed.searchParams.get('url')).toBe('https://bookstr.example')
    const perms = parsed.searchParams.get('perms') ?? ''
    for (const p of NIP46_PERMS) {
      expect(perms.split(',')).toContain(p)
    }
  })
})
