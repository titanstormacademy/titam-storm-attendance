import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { NavigationGuardContext, type GuardState } from './navigation-guard-context'

export function NavigationGuardProvider({ children }: { children: ReactNode }) {
  const [guards, setGuards] = useState<Record<string, GuardState>>({})
  const guardsRef = useRef(guards)
  guardsRef.current = guards
  const blocked = Object.values(guards).some((guard) => guard.dirty || guard.pending)

  const confirmDiscard = useCallback((state: GuardState) => {
    if (state.pending) return window.confirm('A save is still in progress. Leave this screen anyway?')
    return !state.dirty || window.confirm('Discard your unsaved changes?')
  }, [])

  const confirmLeave = useCallback(() => confirmDiscard({
    dirty: Object.values(guardsRef.current).some((guard) => guard.dirty),
    pending: Object.values(guardsRef.current).some((guard) => guard.pending),
  }), [confirmDiscard])

  const setGuard = useCallback((key: string, state: GuardState | null) => {
    setGuards((current) => {
      if (!state) {
        if (!(key in current)) return current
        const next = { ...current }
        delete next[key]
        return next
      }
      const existing = current[key]
      if (existing?.dirty === state.dirty && existing.pending === state.pending) return current
      return { ...current, [key]: state }
    })
  }, [])

  useEffect(() => {
    if (!blocked) return
    const handler = (event: BeforeUnloadEvent) => {
      event.preventDefault()
      event.returnValue = true
    }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [blocked])

  const value = useMemo(() => ({ confirmLeave, confirmDiscard, setGuard }), [confirmDiscard, confirmLeave, setGuard])
  return <NavigationGuardContext.Provider value={value}>{children}</NavigationGuardContext.Provider>
}
