import { useCallback, useEffect, useState } from 'react'

// A refresh shouldn't reset the visible resend timer to zero — the real OTP
// expiry is server-side either way, this just keeps the UI honest. Shared by
// the email-verification and phone-verification OTP steps.
function storageKey(namespace: string, key: string): string {
  return `${namespace}-resend-until:${key}`
}

function readStoredCooldown(namespace: string, key: string): number {
  const until = Number(sessionStorage.getItem(storageKey(namespace, key)) ?? 0)
  return Math.max(0, Math.ceil((until - Date.now()) / 1000))
}

export function useOtpCooldown(namespace: string, key: string) {
  const [cooldown, setCooldown] = useState(() => readStoredCooldown(namespace, key))

  useEffect(() => {
    if (cooldown <= 0) return
    const timer = setInterval(() => setCooldown((c) => Math.max(0, c - 1)), 1000)
    return () => clearInterval(timer)
  }, [cooldown])

  const start = useCallback(
    (seconds: number) => {
      sessionStorage.setItem(storageKey(namespace, key), String(Date.now() + seconds * 1000))
      setCooldown(seconds)
    },
    [namespace, key],
  )
  const clear = useCallback(() => {
    sessionStorage.removeItem(storageKey(namespace, key))
    setCooldown(0)
  }, [namespace, key])

  return { cooldown, start, clear }
}
