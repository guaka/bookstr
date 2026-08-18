import { useEffect, useRef, useState } from 'react'
import {
  clearIdentity,
  connectBunkerInput,
  connectNip07,
  getAuthMode,
  getNpub,
  getNsec,
  getRelays,
  pullProgress,
  pullVocabulary,
  restoreNip46,
  setNsec,
  setRelays,
  startNip46QrConnect,
  waitForNip07,
  type AuthMode,
  type Nip46QrSession,
} from '../lib/nostr'
import type { Theme } from '../types'
import { Footer } from './Footer'
import { CloseIcon } from './Icons'

type Props = {
  onBack: () => void
  theme: Theme
  onTheme: (t: Theme) => void
}

function shortNpub(npub: string) {
  if (npub.length < 20) return npub
  return `${npub.slice(0, 12)}…${npub.slice(-8)}`
}

function modeLabel(mode: AuthMode): string {
  switch (mode) {
    case 'nip07':
      return 'extension'
    case 'nip46':
      return 'NIP-46'
    case 'nsec':
      return 'nsec'
    default:
      return ''
  }
}

export function Settings({ onBack, theme, onTheme }: Props) {
  const [nsec, setNsecField] = useState('')
  const [npub, setNpub] = useState('')
  const [mode, setMode] = useState<AuthMode>('none')
  const [nip07, setNip07] = useState(false)
  const [showNsec, setShowNsec] = useState(false)
  const [showBunkerPaste, setShowBunkerPaste] = useState(false)
  const [bunkerInput, setBunkerInput] = useState('')
  const [relays, setRelaysField] = useState('')
  const [status, setStatus] = useState('')
  const [qrSession, setQrSession] = useState<Nip46QrSession | null>(null)
  const [connectingBunker, setConnectingBunker] = useState(false)
  const qrSessionRef = useRef<Nip46QrSession | null>(null)
  const onBackRef = useRef(onBack)
  onBackRef.current = onBack

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onBackRef.current()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      qrSessionRef.current?.cancel()
    }
  }, [])

  useEffect(() => {
    void (async () => {
      setRelaysField((await getRelays()).join('\n'))
      const available = await waitForNip07()
      setNip07(available)
      const auth = await getAuthMode()
      const storedNsec = await getNsec()

      if (available) {
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

      if (auth === 'nip46') {
        try {
          const restored = await restoreNip46()
          if (restored) {
            setMode(restored.mode)
            setNpub(restored.npub)
            setStatus('Connected via NIP-46 remote signer')
            return
          }
        } catch (e) {
          setStatus(e instanceof Error ? e.message : String(e))
        }
      }

      setMode(auth)
      setNpub(await getNpub())
      setNsecField(storedNsec)
      if (auth === 'nsec' || (!available && !storedNsec && auth === 'none')) {
        setShowNsec(true)
      }
    })()
  }, [])

  async function disconnect() {
    qrSessionRef.current?.cancel()
    qrSessionRef.current = null
    setQrSession(null)
    await clearIdentity()
    setMode('none')
    setNpub('')
    setNsecField('')
    setBunkerInput('')
    setStatus('Disconnected')
  }

  async function beginQrConnect() {
    qrSessionRef.current?.cancel()
    setStatus('Waiting for Amber (or another NIP-46 signer) to scan…')
    try {
      const session = await startNip46QrConnect()
      qrSessionRef.current = session
      setQrSession(session)
      void session.done
        .then((connected) => {
          setMode(connected.mode)
          setNpub(connected.npub)
          setNsecField('')
          setShowNsec(false)
          setStatus('Connected via NIP-46')
        })
        .catch((e) => {
          setStatus(e instanceof Error ? e.message : String(e))
        })
        .finally(() => {
          if (qrSessionRef.current === session) {
            qrSessionRef.current = null
            setQrSession(null)
          }
        })
    } catch (e) {
      setStatus(e instanceof Error ? e.message : String(e))
      setQrSession(null)
    }
  }

  return (
    <div
      className="settings-overlay"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onBack()
      }}
    >
      <section className="settings settings-panel" role="dialog" aria-modal="true" aria-labelledby="settings-heading">
      <header className="library-header">
        <h1 id="settings-heading">Settings</h1>
        <button className="icon-button" type="button" onClick={onBack} aria-label="Close settings">
          <CloseIcon />
        </button>
      </header>

      <label>
        Theme
        <select
          value={theme}
          onChange={(e) => onTheme(e.target.value as Theme)}
        >
          <option value="white">White</option>
          <option value="paper">Paper</option>
          <option value="night">Night</option>
        </select>
      </label>

      <h2>Nostr sync</h2>

      {mode !== 'none' && npub && (
        <p className="mono" title={npub}>
          {modeLabel(mode)} · {shortNpub(npub)}
        </p>
      )}

      {mode === 'nip46' && (
        <div className="nip07-card">
          <p>
            <strong>Connected via remote signer (NIP-46)</strong> — Amber or another bunker signs
            progress events. Your nsec never enters this page.
          </p>
          <div className="row">
            <button type="button" onClick={() => void disconnect()}>
              Disconnect
            </button>
          </div>
        </div>
      )}

      {mode !== 'nip46' && (
        <>
          {nip07 ? (
            <div className="nip07-card">
              {mode === 'nip07' ? (
                <p>
                  <strong>Connected via browser extension</strong> — signing uses NIP-07. Your
                  private key never enters this page.
                </p>
              ) : (
                <p>
                  <strong>Browser extension detected</strong> — connect to sync without pasting an
                  nsec, or use Amber via QR below.
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
                  <button type="button" onClick={() => void disconnect()}>
                    Disconnect
                  </button>
                )}
              </div>
            </div>
          ) : mode === 'none' ? (
            <p className="muted">
              No NIP-07 extension found. Connect Amber with a QR code, paste a bunker URI, or use
              an nsec (advanced).
            </p>
          ) : null}

          <div className="nip07-card">
            <p>
              <strong>Remote signer (NIP-46)</strong> — scan with Amber on your phone. Uses your
              configured relays.
            </p>
            {qrSession ? (
              <div className="nip46-qr">
                <img src={qrSession.qrDataUrl} alt="nostrconnect QR code for Amber" width={280} height={280} />
                <p className="muted">Scan with Amber, then approve bookstr.</p>
                <details>
                  <summary>Show connection URI</summary>
                  <code className="nip46-uri">{qrSession.uri}</code>
                </details>
                <div className="row">
                  <button
                    type="button"
                    onClick={() => {
                      qrSession.cancel()
                      qrSessionRef.current = null
                      setQrSession(null)
                      setStatus('Cancelled NIP-46 connect')
                    }}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <div className="row">
                <button type="button" onClick={() => void beginQrConnect()}>
                  Show Amber QR
                </button>
                <button type="button" className="linkish" onClick={() => setShowBunkerPaste((v) => !v)}>
                  {showBunkerPaste ? 'Hide bunker paste' : 'Paste bunker:// instead'}
                </button>
              </div>
            )}
            {showBunkerPaste && !qrSession && (
              <>
                <label>
                  bunker:// or NIP-05
                  <input
                    value={bunkerInput}
                    onChange={(e) => setBunkerInput(e.target.value)}
                    placeholder="bunker://… or name@domain"
                    autoComplete="off"
                  />
                </label>
                <button
                  type="button"
                  disabled={connectingBunker}
                  onClick={() => {
                    void (async () => {
                      setConnectingBunker(true)
                      setStatus('Connecting to bunker…')
                      try {
                        const connected = await connectBunkerInput(bunkerInput)
                        setMode(connected.mode)
                        setNpub(connected.npub)
                        setNsecField('')
                        setShowNsec(false)
                        setBunkerInput('')
                        setStatus('Connected via NIP-46 bunker')
                      } catch (e) {
                        setStatus(e instanceof Error ? e.message : String(e))
                      } finally {
                        setConnectingBunker(false)
                      }
                    })()
                  }}
                >
                  {connectingBunker ? 'Connecting…' : 'Connect bunker'}
                </button>
              </>
            )}
          </div>

          <button type="button" className="linkish" onClick={() => setShowNsec((v) => !v)}>
            {showNsec ? 'Hide nsec fallback' : 'Use nsec instead (advanced)'}
          </button>
        </>
      )}

      {(showNsec || (!nip07 && mode === 'nsec')) && mode !== 'nip46' && (
        <>
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
                    setStatus(pub ? 'nsec saved' : 'Cleared')
                  } catch (e) {
                    setStatus(e instanceof Error ? e.message : String(e))
                  }
                })()
              }}
            >
              Save nsec
            </button>
            <button type="button" onClick={() => void disconnect()}>
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
              const [progressCount, wordCount] = await Promise.all([
                pullProgress(),
                pullVocabulary(),
              ])
              setStatus(`Merged ${progressCount} progress update(s) and ${wordCount} word(s)`)
            } catch (e) {
              setStatus(e instanceof Error ? e.message : String(e))
            }
          })()
        }}
      >
        Sync now
      </button>

      {status && <p className="status">{status}</p>}
      <Footer />
      </section>
    </div>
  )
}
