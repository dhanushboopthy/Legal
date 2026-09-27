import { useEffect, useState } from 'react'

// On a phone the keyboard shrinks the *visual* viewport but not the layout one,
// so a fixed-height chat would slide under it. Follow the visual viewport.
export function useVisualViewportHeight(): number | null {
  const [height, setHeight] = useState<number | null>(null)
  useEffect(() => {
    const viewport = window.visualViewport
    if (!viewport) return
    const update = () => setHeight(viewport.height)
    update()
    viewport.addEventListener('resize', update)
    return () => viewport.removeEventListener('resize', update)
  }, [])
  return height
}
