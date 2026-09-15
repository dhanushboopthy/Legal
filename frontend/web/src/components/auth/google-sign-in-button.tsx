import { useEffect, useRef } from 'react'

import {
  GOOGLE_CLIENT_ID as CLIENT_ID,
  loadGoogleIdentityScript,
} from '@/hooks/use-google-identity'

export function GoogleSignInButton({
  onCredential,
  onError,
}: {
  onCredential: (idToken: string) => void
  onError?: (message: string) => void
}) {
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!CLIENT_ID) return

    let cancelled = false
    loadGoogleIdentityScript()
      .then(() => {
        if (cancelled || !containerRef.current || !window.google) return
        window.google.accounts.id.initialize({
          client_id: CLIENT_ID,
          callback: (response) => onCredential(response.credential),
        })
        window.google.accounts.id.renderButton(containerRef.current, {
          type: 'standard',
          theme: 'outline',
          size: 'large',
          width: 320,
          text: 'continue_with',
        })
      })
      .catch(() => {
        if (!cancelled) onError?.('Could not load Google Sign-In')
      })

    return () => {
      cancelled = true
    }
  }, [onCredential, onError])

  // No client ID configured for this deployment — hide the button rather
  // than render one that can never work.
  if (!CLIENT_ID) return null

  return <div ref={containerRef} className="flex justify-center" />
}
