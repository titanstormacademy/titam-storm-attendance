import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { createTheme, MantineProvider } from '@mantine/core'
import { Notifications } from '@mantine/notifications'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import '@mantine/core/styles.css'
import '@mantine/notifications/styles.css'
import './index.css'
import './motion.css'
import App from './App'
import { AuthProvider } from './contexts/AuthContext'
import { NavigationGuardProvider } from './contexts/NavigationGuardContext'

const theme = createTheme({
  primaryColor: 'orange',
  defaultRadius: 'md',
  fontFamily: 'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  headings: { fontFamily: '"Barlow Condensed", "Arial Narrow", sans-serif', fontWeight: '700' },
  colors: {
    orange: ['#fff4ed', '#ffe5d6', '#ffc9aa', '#ffa06f', '#ff7f43', '#f26522', '#d4531f', '#b74117', '#8f3315', '#6f2a15'],
  },
})

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 30_000, retry: 1, refetchOnWindowFocus: false },
  },
})

function syncViewport() {
  const viewport = window.visualViewport
  document.documentElement.style.setProperty('--viewport-width', `${Math.round(viewport?.width || window.innerWidth)}px`)
  document.documentElement.style.setProperty('--viewport-height', `${Math.round(viewport?.height || window.innerHeight)}px`)
}

syncViewport()
window.addEventListener('resize', syncViewport)
window.addEventListener('orientationchange', syncViewport)
window.visualViewport?.addEventListener('resize', syncViewport)
window.visualViewport?.addEventListener('scroll', syncViewport)

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <MantineProvider theme={theme} defaultColorScheme="light">
      <Notifications position="top-right" />
      <QueryClientProvider client={queryClient}>
        <AuthProvider><NavigationGuardProvider><App /></NavigationGuardProvider></AuthProvider>
      </QueryClientProvider>
    </MantineProvider>
  </StrictMode>,
)
