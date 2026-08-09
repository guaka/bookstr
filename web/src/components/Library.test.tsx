import { describe, expect, it, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { Library } from '../components/Library'
import type { CatalogBook } from '../types'

const books: CatalogBook[] = [
  {
    id: '1',
    title: 'Little Brother',
    author: 'Cory Doctorow',
    license: 'CC BY-NC-SA 3.0',
    epubUrl: './books/1.epub',
  },
]

describe('Library', () => {
  it('renders books and wires actions', () => {
    const onOpen = vi.fn()
    const onSettings = vi.fn()
    const onRefresh = vi.fn()

    render(
      <Library
        books={books}
        loading={false}
        error={null}
        onOpen={onOpen}
        onSettings={onSettings}
        onRefresh={onRefresh}
      />,
    )

    expect(screen.getByRole('heading', { name: 'bookstr' })).toBeTruthy()
    expect(screen.getByText('Little Brother')).toBeTruthy()
    expect(screen.getByText('Cory Doctorow')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Settings' }))
    expect(onSettings).toHaveBeenCalledTimes(1)

    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }))
    expect(onRefresh).toHaveBeenCalledTimes(1)

    fireEvent.click(screen.getByRole('button', { name: /Little Brother/ }))
    expect(onOpen).toHaveBeenCalledWith(books[0])
  })

  it('shows loading and empty states', () => {
    const { rerender } = render(
      <Library
        books={[]}
        loading
        error={null}
        onOpen={vi.fn()}
        onSettings={vi.fn()}
        onRefresh={vi.fn()}
      />,
    )
    expect(screen.getByText(/Loading catalog/)).toBeTruthy()

    rerender(
      <Library
        books={[]}
        loading={false}
        error={null}
        onOpen={vi.fn()}
        onSettings={vi.fn()}
        onRefresh={vi.fn()}
      />,
    )
    expect(screen.getByText(/No books/)).toBeTruthy()

    rerender(
      <Library
        books={[]}
        loading={false}
        error="boom"
        onOpen={vi.fn()}
        onSettings={vi.fn()}
        onRefresh={vi.fn()}
      />,
    )
    expect(screen.getByText('boom')).toBeTruthy()
  })
})
