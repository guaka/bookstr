const FAVORITES_KEY = 'bookstr.favorites'

export function loadFavorites(): string[] {
  try {
    const value = JSON.parse(window.localStorage.getItem(FAVORITES_KEY) ?? '[]')
    return Array.isArray(value) ? value.filter((id): id is string => typeof id === 'string') : []
  } catch {
    return []
  }
}

export function saveFavorites(ids: Iterable<string>): void {
  try {
    window.localStorage.setItem(FAVORITES_KEY, JSON.stringify([...ids]))
  } catch {
    // Favorites still work for this session when storage is disabled.
  }
}
