import { useContext, useEffect } from 'react'
import { NavigationGuardContext, type GuardState } from './navigation-guard-context'

export function useNavigationGuard(key: string, state: GuardState) {
  const context = useContext(NavigationGuardContext)
  if (!context) throw new Error('useNavigationGuard must be used within NavigationGuardProvider')
  const { dirty, pending } = state

  useEffect(() => {
    context.setGuard(key, { dirty, pending })
    return () => context.setGuard(key, null)
  }, [context, dirty, key, pending])

  return context
}

export function useNavigationGuardContext() {
  const context = useContext(NavigationGuardContext)
  if (!context) throw new Error('useNavigationGuardContext must be used within NavigationGuardProvider')
  return context
}
