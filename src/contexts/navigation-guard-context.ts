import { createContext } from 'react'

export interface GuardState {
  dirty: boolean
  pending: boolean
}

export interface NavigationGuardValue {
  confirmLeave: () => boolean
  confirmDiscard: (state: GuardState) => boolean
  setGuard: (key: string, state: GuardState | null) => void
}

export const NavigationGuardContext = createContext<NavigationGuardValue | null>(null)
