import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { createTheme, MantineProvider } from '@mantine/core'
import { Notifications } from '@mantine/notifications'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import '@mantine/core/styles.css'
import '@mantine/notifications/styles.css'
import './index.css'
import App from './App'
import { AuthProvider } from './contexts/AuthContext'

const theme = createTheme({
  primaryColor: 'orange',
  defaultRadius: 'md',
  fontFamily: 'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  headings: { fontFamily: 'Inter, ui-sans-serif, system-ui, sans-serif', fontWeight: '750' },
  colors: {
    orange: ['#fff5eb', '#ffe8d3', '#ffd0a4', '#ffb570', '#ff9e44', '#f58a23', '#dc7415', '#b75d12', '#924a14', '#773f14'],
  },
})

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 30_000, retry: 1, refetchOnWindowFocus: false },
  },
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <MantineProvider theme={theme} defaultColorScheme="light">
      <Notifications position="top-right" />
      <QueryClientProvider client={queryClient}>
        <AuthProvider><App /></AuthProvider>
      </QueryClientProvider>
    </MantineProvider>
  </StrictMode>,
)
