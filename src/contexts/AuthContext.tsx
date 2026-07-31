import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { getProfile, loginWithSimpleAccess } from '../lib/api'
import { supabase } from '../lib/supabase'
import type { Profile } from '../types/models'
import { AuthContext, type AuthContextValue } from './auth-context'

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [loading, setLoading] = useState(true)
  const simpleLoginInProgress = useRef(false)

  useEffect(() => {
    let active = true

    async function applySession(nextSession: Session | null) {
      if (!active) return
      if (nextSession?.user) setLoading(true)
      setSession(nextSession)
      if (simpleLoginInProgress.current && nextSession?.user?.is_anonymous) return
      if (!nextSession?.user) {
        setProfile(null)
        setLoading(false)
        return
      }
      try {
        setProfile(await getProfile(nextSession.user.id))
      } finally {
        if (active) setLoading(false)
      }
    }

    supabase.auth.getSession().then(({ data }) => applySession(data.session))
    const { data: subscription } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setTimeout(() => applySession(nextSession), 0)
    })

    return () => {
      active = false
      subscription.subscription.unsubscribe()
    }
  }, [])

  const value = useMemo<AuthContextValue>(() => ({
    session,
    user: session?.user || null,
    profile,
    loading,
    async signInWithName(name, password) {
      simpleLoginInProgress.current = true
      setLoading(true)
      setProfile(null)
      try {
        const anonymous = await supabase.auth.signInAnonymously({ options: { data: { full_name: name } } })
        if (anonymous.error) throw anonymous.error
        if (!anonymous.data.session?.user) throw new Error('Could not create a secure attendance session')
        const nextProfile = await loginWithSimpleAccess(name, password)
        setSession(anonymous.data.session)
        setProfile(nextProfile)
        setLoading(false)
      } catch (error) {
        await supabase.auth.signOut({ scope: 'local' })
        setSession(null)
        setProfile(null)
        setLoading(false)
        throw error
      } finally {
        simpleLoginInProgress.current = false
      }
    },
    async signIn(email, password) {
      const { error } = await supabase.auth.signInWithPassword({ email, password })
      if (error) throw error
    },
    async signUp(email, password, fullName) {
      const { error } = await supabase.auth.signUp({
        email,
        password,
        options: { data: { full_name: fullName } },
      })
      if (error) throw error
    },
    async signOut() {
      const { error } = await supabase.auth.signOut()
      if (error) throw error
    },
  }), [loading, profile, session])

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
