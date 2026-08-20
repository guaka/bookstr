import { useEffect, useState } from 'react'
import { downloadAndVerify } from '../lib/catalog'
import type { CatalogBook } from '../types'
import { CloseIcon, SettingsIcon } from './Icons'

type Props = {
  book: CatalogBook
  onClose: () => void
  onSettings: () => void
}

export function PdfReader({ book, onClose, onSettings }: Props) {
  const [pdfUrl, setPdfUrl] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let disposed = false
    let objectUrl: string | null = null
    const previousRootOverflow = document.documentElement.style.overflow
    const previousBodyOverflow = document.body.style.overflow
    document.documentElement.style.overflow = 'hidden'
    document.body.style.overflow = 'hidden'

    void downloadAndVerify(book)
      .then((blob) => {
        if (disposed) return
        objectUrl = URL.createObjectURL(blob)
        setPdfUrl(objectUrl)
      })
      .catch((reason) => {
        if (!disposed) setError(reason instanceof Error ? reason.message : String(reason))
      })

    return () => {
      disposed = true
      if (objectUrl) URL.revokeObjectURL(objectUrl)
      document.documentElement.style.overflow = previousRootOverflow
      document.body.style.overflow = previousBodyOverflow
    }
  }, [book])

  return (
    <div className="reader pdf-reader">
      <header className="pdf-reader-header">
        <button className="icon-button" type="button" onClick={onClose} aria-label="Back to library">
          <CloseIcon />
        </button>
        <div className="pdf-reader-title">
          <strong>{book.title}</strong>
          <span>{book.author}</span>
        </div>
        <button className="icon-button" type="button" onClick={onSettings} aria-label="Settings">
          <SettingsIcon />
        </button>
      </header>
      <main className="pdf-reader-surface">
        {!pdfUrl && !error && <div className="reader-status">Opening PDF…</div>}
        {error && <div className="reader-status error">{error}</div>}
        {pdfUrl && (
          <object className="pdf-document" data={pdfUrl} type="application/pdf" aria-label={book.title}>
            <p>
              This browser cannot display PDFs here. <a href={pdfUrl} download>Download the PDF</a> instead.
            </p>
          </object>
        )}
      </main>
    </div>
  )
}
