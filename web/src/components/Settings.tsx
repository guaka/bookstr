import { useEffect, useState } from 'react'
import {
  clearIdentity,
  connectNip07,
  getAuthMode,
  getNpub,
  getNsec,
  getRelays,
  pullProgress,
  setNsec,
  setRelays,
  waitForNip07,
  type AuthMode,
} from '../lib/nostr'
import { getSetting, setSetting } from '../lib/catalog'

type Props = {
  onBack: () => void
  theme: 'paper' | 'night'
  onTheme: (t: 'paper' | 'night') => void
}

function shortNpub(npub: string) {
  if (npub.length < 20) return npub
  return `${npub.slice(0, 12)}…${npub.slice(-8)}`
}

export function Settings({ onBack, theme, onTheme }: Props) {
  const [catalogUrl, setCatalogUrl] = useState('')
  const [nsec, setNsecField] = useState('')
  const [npub, setNpub] = useState('')
  const [mode, setMode] = useState<AuthMode>('none')
  const [nip07, setNip07] = useState(false)
  const [showNsec, setShowNsec] = useState(false)
  const [relays, setRelaysField] = useState('')
  const [status, setStatus] = useState('')

  useEffect(() => {
    void (async () => {
      setCatalogUrl(
        await getSetting(
          'catalogUrl',
          new URL(`${import.meta.env.BASE_URL}catalog/catalog.json`, window.location.origin).toString(),
        ),
      )
      setRelaysField((await getRelays()).join('\n'))
      const available = await waitForNip07()
      setNip07(available)
      const auth = await getAuthMode()
      const storedNsec = await getNsec()

      // Restore an existing NIP-07 session; do not re-prompt after Disconnect
      if (available && auth === 'nip07') {
        try {
          const connected = await connectNip07()
          setMode(connected.mode)
          setNpub(connected.npub)
          setStatus('Using browser Nostr extension (NIP-07)')
          return
        } catch (e) {
          setStatus(e instanceof Error ? e.message : String(e))
        }
      }

      setMode(auth)
      setNpub(await getNpub())
      setNsecField(storedNsec)
      if (auth === 'nsec' || (!available && !storedNsec)) {
        setShowNsec(true)
      }
    })()
  }, [])

  return (
    <div className="settings">
      <header className="library-header">
        <h1>Settings</h1>
        <button type="button" onClick={onBack}>
          Back
        </button>
      </header>

      <label>
        Catalog URL
        <input
          value={catalogUrl}
          onChange={(e) => setCatalogUrl(e.target.value)}
          placeholder="https://books.example.org/catalog.json"
        />
      </label>
      <button
        type="button"
        onClick={() => {
          void setSetting('catalogUrl', catalogUrl.trim())
          setStatus('Catalog URL saved')
        }}
      >
        Save catalog URL
      </button>

      <label>
        Theme
        <select
          value={theme}
          onChange={(e) => onTheme(e.target.value as 'paper' | 'night')}
        >
          <option value="paper">Paper</option>
          <option value="night">Night</option>
        </select>
      </label>

      <h2>Nostr sync</h2>

      {nip07 ? (
        <div className="nip07-card">
          {mode === 'nip07' ? (
            <p>
              <strong>Connected via browser extension</strong> — signing uses NIP-07. Your
              private key never enters this page.
            </p>
          ) : mode === 'nsec' ? (
            <p>
              <strong>Extension available</strong> — currently using a pasted nsec instead.
              Switch to the extension to keep your key out of this page.
            </p>
          ) : (
            <p>
              <strong>Browser extension detected</strong> — connect to sync reading progress
              without pasting an nsec.
            </p>
          )}
          {npub && mode !== 'none' && (
            <p className="mono" title={npub}>
              {mode === 'nsec' ? 'nsec · ' : ''}
              {shortNpub(npub)}
            </p>
          )}
          <div className="row">
            <button
              type="button"
              onClick={() => {
                void (async () => {
                  try {
                    const connected = await connectNip07()
                    setMode(connected.mode)
                    setNpub(connected.npub)
                    setNsecField('')
                    setShowNsec(false)
                    setStatus('Connected via NIP-07')
                  } catch (e) {
                    setStatus(e instanceof Error ? e.message : String(e))
                  }
                })()
              }}
            >
              {mode === 'nip07' ? 'Reconnect extension' : 'Use extension'}
            </button>
            {mode !== 'none' && (
              <button
                type="button"
                onClick={() => {
                  void (async () => {
                    await clearIdentity()
                    setMode('none')
                    setNpub('')
                    setNsecField('')
                    setStatus('Disconnected')
                  })()
                }}
              >
                Disconnect
              </button>
            )}
          </div>
          <button type="button" className="linkish" onClick={() => setShowNsec((v) => !v)}>
            {showNsec ? 'Hide nsec fallback' : 'Use nsec instead (advanced)'}
          </button>
        </div>
      ) : (
        <p className="muted">
          No NIP-07 extension found. Install Alby, nos2x, or similar — or paste an nsec below.
          Never share your nsec.
        </p>
      )}

      {(showNsec || !nip07) && (
        <>
          {mode === 'nsec' && npub && !nip07 && (
            <p className="mono" title={npub}>
              nsec mode · {shortNpub(npub)}
            </p>
          )}
          <label>
            nsec
            <input
              type="password"
              autoComplete="off"
              value={nsec}
              onChange={(e) => setNsecField(e.target.value)}
              placeholder="nsec1…"
            />
          </label>
          <div className="row">
            <button
              type="button"
              onClick={() => {
                void (async () => {
                  try {
                    const pub = await setNsec(nsec)
                    setNpub(pub)
                    setMode(pub ? 'nsec' : 'none')
                    setStatus(pub ? 'nsec saved (extension not used)' : 'Cleared')
                  } catch (e) {
                    setStatus(e instanceof Error ? e.message : String(e))
                  }
                })()
              }}
            >
              Save nsec
            </button>
            <button
              type="button"
              onClick={() => {
                void (async () => {
                  await clearIdentity()
                  setNsecField('')
                  setNpub('')
                  setMode('none')
                  setStatus('Cleared Nostr identity')
                })()
              }}
            >
              Clear
            </button>
          </div>
        </>
      )}

      <label>
        Relays (one per line)
        <textarea value={relays} onChange={(e) => setRelaysField(e.target.value)} rows={4} />
      </label>
      <button
        type="button"
        onClick={() => {
          void setRelays(relays)
          setStatus('Relays saved')
        }}
      >
        Save relays
      </button>
      <button
        type="button"
        onClick={() => {
          void (async () => {
            try {
              const n = await pullProgress()
              setStatus(`Merged ${n} remote progress update(s)`)
            } catch (e) {
              setStatus(e instanceof Error ? e.message : String(e))
            }
          })()
        }}
      >
        Sync now
      </button>

      {status && <p className="status">{status}</p>}
    </div>
  )
}
