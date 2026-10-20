import { useEffect, useState } from 'react'

const matches = (query) => typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia(query).matches

/** Whether a CSS media query matches, updating when it changes (for example a tablet's keyboard detaching). */
export default function useMediaQuery(query) {
  const [value, setValue] = useState(() => matches(query))
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return undefined
    const list = window.matchMedia(query)
    const update = () => setValue(list.matches)
    update()
    list.addEventListener?.('change', update)
    return () => list.removeEventListener?.('change', update)
  }, [query])
  return value
}
