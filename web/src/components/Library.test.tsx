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

    render(
      <Library
        books={books}
        loading={false}
        error={null}
        onOpen={onOpen}
        onSettings={onSettings}
        onFavorites={vi.fn()}
        onWords={vi.fn()}
        onHome={vi.fn()}
        onToggleFavorite={vi.fn()}
        favoriteIds={new Set()}
        progressById={new Map()}
        externalFavorites={[]}
        vocabulary={[]}
        favoritesActive={false}
        wordsActive={false}
      />,
    )

    expect(screen.getByRole('button', { name: 'Bookstr home' })).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Favorites' })).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Reading' })).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Examples' })).toBeTruthy()
    expect(screen.getByText('Little Brother')).toBeTruthy()
    expect(screen.getByText('Cory Doctorow')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Bookstr on GitHub' }).getAttribute('href')).toBe(
      'https://github.com/guaka/bookstr',
    )
    expect(screen.getByText(/^(Development build|Built .+ UTC)$/)).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Settings' }))
    expect(onSettings).toHaveBeenCalledTimes(1)

    expect(screen.queryByRole('button', { name: 'Refresh' })).toBeNull()

    fireEvent.click(screen.getByText('Little Brother').closest('button')!)
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
        onFavorites={vi.fn()}
        onWords={vi.fn()}
        onHome={vi.fn()}
        onToggleFavorite={vi.fn()}
        favoriteIds={new Set()}
        progressById={new Map()}
        externalFavorites={[]}
        vocabulary={[]}
        favoritesActive={false}
        wordsActive={false}
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
        onFavorites={vi.fn()}
        onWords={vi.fn()}
        onHome={vi.fn()}
        onToggleFavorite={vi.fn()}
        favoriteIds={new Set()}
        progressById={new Map()}
        externalFavorites={[]}
        vocabulary={[]}
        favoritesActive={false}
        wordsActive={false}
      />,
    )
    expect(screen.getAllByText(/Heart a book/).length).toBeGreaterThan(0)

    rerender(
      <Library
        books={[]}
        loading={false}
        error="boom"
        onOpen={vi.fn()}
        onSettings={vi.fn()}
        onFavorites={vi.fn()}
        onWords={vi.fn()}
        onHome={vi.fn()}
        onToggleFavorite={vi.fn()}
        favoriteIds={new Set()}
        progressById={new Map()}
        externalFavorites={[]}
        vocabulary={[]}
        favoritesActive={false}
        wordsActive={false}
      />,
    )
    expect(screen.getByText('boom')).toBeTruthy()
  })
})
