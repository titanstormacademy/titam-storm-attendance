import { supabase } from './supabase'

export interface StudentAttendanceEntry {
  attendance_date: string
  remarks: string
  is_trial: boolean
  class: { label: string } | null
}

export async function getStudentAttendance(studentId: number) {
  const { data, error } = await supabase
    .from('attendance')
    .select('attendance_date,remarks,is_trial,class:classes(label)')
    .eq('student_id', studentId)
    .eq('status', 'Present')
    .order('attendance_date', { ascending: false })
  if (error) throw new Error(error.message)
  return (data || []) as unknown as StudentAttendanceEntry[]
}

export async function updateEnrollmentStartDate(enrollmentId: number, startDate: string) {
  const { error } = await supabase.from('enrollments').update({ start_date: startDate }).eq('id', enrollmentId)
  if (error) throw new Error(error.message)
}
