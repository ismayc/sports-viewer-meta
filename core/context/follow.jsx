import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'

const KEY = 'wnba:followed'
const FollowCtx = createContext(null)

// Inert fallback so components (and tests) render standalone without a provider.
const FALLBACK = {
  followed: new Set(),
  isFollowed: () => false,
  toggle: () => {},
  count: 0,
  clear: () => {},
}

export function FollowProvider({ children }) {
  const [followed, setFollowed] = useState(() => {
    try {
      return new Set(JSON.parse(localStorage.getItem(KEY) || '[]'))
    } catch {
      return new Set()
    }
  })

  useEffect(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify([...followed]))
    } catch {
      /* private mode — following just won't persist */
    }
  }, [followed])

  const toggle = useCallback((abbr) => {
    setFollowed((prev) => {
      const next = new Set(prev)
      next.has(abbr) ? next.delete(abbr) : next.add(abbr)
      return next
    })
  }, [])

  const value = useMemo(
    () => ({
      followed,
      isFollowed: (abbr) => followed.has(abbr),
      toggle,
      count: followed.size,
      clear: () => setFollowed(new Set()),
    }),
    [followed, toggle]
  )

  return <FollowCtx.Provider value={value}>{children}</FollowCtx.Provider>
}

export const useFollow = () => useContext(FollowCtx) || FALLBACK
