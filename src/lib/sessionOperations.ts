import { supabase } from './supabase'
import type { Session } from '../types/models'

export async function getClassSessions(classId: number) {
  const { data, error } = await supabase.from('sessions').select('*,class:classes(id,label,start_time,end_time),coach:coaches(id,name)').eq('class_id', classId).order('session_date', { ascending: false })
  if (error) throw new Error(error.message)
  return (data || []) as Session[]
}

export async function saveSession(input: { id?: number; branch_id: number; class_id: number; session_date: string; notes: string; coach_id: number | null }) {
  const query = input.id
    ? supabase.from('sessions').update(input).eq('id', input.id)
    : supabase.from('sessions').insert(input)
  const { data, error } = await query.select('*,class:classes(id,label,start_time,end_time),coach:coaches(id,name)').single()
  if (error) throw new Error(error.message)
  return data as Session
}

export async function deleteSession(sessionId: number) {
  const { error } = await supabase.from('sessions').delete().eq('id', sessionId)
  if (error) throw new Error(error.message)
}
