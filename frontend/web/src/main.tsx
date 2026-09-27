import { QueryClientProvider } from '@tanstack/react-query'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import { App } from '@/App'
import { ToastProvider } from '@/components/ui/toast'
import { applyTextSize, getTextSize } from '@/lib/preferences'
import { queryClient } from '@/lib/query-client'
import '@fontsource-variable/inter'
import '@/index.css'

// Before the first render, so the page never flashes at the wrong size.
applyTextSize(getTextSize())

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <App />
      </ToastProvider>
    </QueryClientProvider>
  </StrictMode>,
)
