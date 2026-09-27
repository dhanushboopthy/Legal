import { useEffect } from 'react'

const APP_NAME = 'Advocate Filing'

/** The browser tab and screen-reader page title: "Case LF-2026-0042 · Advocate Filing". */
export function usePageTitle(title: string | undefined) {
  useEffect(() => {
    document.title = title ? `${title} · ${APP_NAME}` : APP_NAME
  }, [title])
}
