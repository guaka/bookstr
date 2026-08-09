import { useEffect, useState } from 'react'
import {
  getNpub,
  getNsec,
  getRelays,
  pullProgress,
  setNsec,
  setRelays,
} from '../lib/nostr'
import { getSetting, setSetting } from '../lib/catalog'

type Props = {
  onBack: () => void
  theme: 'paper' | 'night'
  onTheme: (t: 'paper' | 'night') => void
}

export function Settings({ onBack, theme, onTheme }: Props) {
  const [catalogUrl, setCatalogUrl] = useState('')
  const [nsec, setNsecField] = useState('')
  const [npub, setNpub] = useState('')
  const [relays, setRelaysField] = useState('')
  const [status, setStatus] = useState('')

  useEffect(() => {
    void (async () => {
      setCatalogUrl(await getSetting('catalogUrl', `${window.location.origin}/catalog/catalog.json`))
      setNsecField(await getNsec())
      setNpub(await getNpub())
      setRelaysField((await getRelays()).join('\n'))
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
          placeholder="https://books.example.com/catalog.json"
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
      <p className="muted">
        Optional. Paste your nsec to sync reading progress (NIP-78). Never share your nsec.
      </p>
      {npub && (
        <p className="mono">
          npub: {npub.slice(0, 16)}…{npub.slice(-8)}
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
                setStatus(pub ? 'Nostr identity saved' : 'Cleared')
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
              await setNsec('')
              setNsecField('')
              setNpub('')
              setStatus('Cleared Nostr identity')
            })()
          }}
        >
          Clear
        </button>
      </div>

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
