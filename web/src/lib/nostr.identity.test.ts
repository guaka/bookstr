import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { generateSecretKey, getPublicKey, nip19 } from 'nostr-tools'
import { resetCatalogDbForTests, setSetting } from './catalog'
import {
  clearIdentity,
  getAuthMode,
  getRelays,
  hasNip07,
  setNsec,
  setRelays,
  waitForNip07,
} from './nostr'

describe('nostr identity helpers', () => {
  beforeEach(async () => {
    await resetCatalogDbForTests()
    Reflect.deleteProperty(window, 'nostr')
    vi.restoreAllMocks()
  })

  afterEach(async () => {
    await resetCatalogDbForTests()
    Reflect.deleteProperty(window, 'nostr')
  })

  it('parses relays from newlines and commas', async () => {
    await setRelays('wss://a.example\nwss://b.example, wss://c.example\n')
    expect(await getRelays()).toEqual([
      'wss://a.example',
      'wss://b.example',
      'wss://c.example',
    ])
  })

  it('stores and clears nsec mode', async () => {
    const sk = generateSecretKey()
    const nsec = nip19.nsecEncode(sk)
    const npub = await setNsec(nsec)
    expect(npub).toBe(nip19.npubEncode(getPublicKey(sk)))
    expect(await getAuthMode()).toBe('nsec')

    await clearIdentity()
    expect(await getAuthMode()).toBe('none')
    expect(await setNsec('')).toBe('')
  })

  it('rejects non-nsec secrets', async () => {
    await expect(setNsec('npub1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq')).rejects.toThrow(
      /Expected nsec/,
    )
  })

  it('detects NIP-07 availability', async () => {
    expect(hasNip07()).toBe(false)
    window.nostr = {
      getPublicKey: async () => 'ab',
      signEvent: async (e) => ({ ...e, id: '1', pubkey: 'ab', sig: 's' }),
    }
    expect(hasNip07()).toBe(true)
    expect(await waitForNip07(50)).toBe(true)
  })

  it('reads authMode from settings', async () => {
    await setSetting('authMode', 'nip46')
    expect(await getAuthMode()).toBe('nip46')
    await setSetting('authMode', 'bogus')
    expect(await getAuthMode()).toBe('none')
  })
})
