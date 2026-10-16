import { useEffect, useState } from 'react';

export const FAVORITES_BOARD = '__favorites__';
export const favoriteKey = (boardId: string, serviceId: string) =>
  JSON.stringify([boardId, serviceId]);

export function useFavorites(userId: string) {
  const key = `directory:favorites:${userId}`;
  const [favorites, setFavorites] = useState<string[]>([]);
  useEffect(() => {
    const read = () => {
      try {
        const value: unknown = JSON.parse(localStorage.getItem(key) || '[]');
        setFavorites(
          Array.isArray(value)
            ? value.filter((item): item is string => typeof item === 'string')
            : [],
        );
      } catch {
        setFavorites([]);
      }
    };
    read();
    window.addEventListener('storage', read);
    window.addEventListener('directory:favorites', read);
    return () => {
      window.removeEventListener('storage', read);
      window.removeEventListener('directory:favorites', read);
    };
  }, [key]);
  function toggleFavorite(id: string) {
    const next = favorites.includes(id)
      ? favorites.filter((value) => value !== id)
      : [...favorites, id];
    try {
      localStorage.setItem(key, JSON.stringify(next));
      setFavorites(next);
      window.dispatchEvent(new Event('directory:favorites'));
    } catch {
      /* Keep the current selection when browser storage is unavailable. */
    }
  }
  return { favorites, toggleFavorite };
}
