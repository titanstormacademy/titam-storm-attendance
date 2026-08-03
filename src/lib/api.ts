import dayjs from 'dayjs'
import { supabase, thumbnailPath } from './supabase'
import type {
  AcademyClass,
  Attendance,
  BootstrapData,
  Branch,
  Coach,
  CoachAttendance,
  CoachPayment,
  CommissionSummary,
  Enrollment,
  HeadCoachRate,
  Payment,
  PaymentMethod,
  PaymentStatus,
  Profile,
  Session,
  Student,
} from '../types/models'

function unwrap<T>(result: { data: T | null; error: { message: string } | null }) {
  if (result.error) throw new Error(result.error.message)
  return result.data as T
}

export async function getProfile(userId: string) {
  return unwrap(await supabase.from('profiles').select('id,full_name,role').eq('id', userId).single()) as Profile
}

export async function loginWithSimpleAccess(name: string, password?: string) {
  if (!password) return unwrap(await supabase.rpc('login_as_basic', { p_name: name })) as Profile
  const result = unwrap(await supabase.rpc('login_with_shared_admin_password', { p_name: name, p_password: password })) as { ok: boolean; error?: string; profile?: Profile }
  if (!result.ok || !result.profile) throw new Error(result.error || 'Admin login failed')
  return result.profile
}

export async function setSharedAdminPassword(password: string) {
  unwrap(await supabase.rpc('set_shared_admin_password', { p_password: password }))
}

export async function getBranches() {
  const data = unwrap(await supabase.from('branches').select('id,name,subtitle,status').order('name'))
  return data as Branch[]
}

export async function getAcademySettings() {
  return unwrap(await supabase.from('academy_settings').select('*').eq('singleton', true).single()) as {
    academy_name: string
    logo_path: string | null
    default_branch_id: number | null
  }
}

export async function getBootstrapData(branchId: number, includePayments: boolean): Promise<BootstrapData> {
  if (!includePayments) {
    return unwrap(await supabase.rpc('get_basic_bootstrap', { p_branch_id: branchId })) as BootstrapData
  }
  const [studentsResult, coachesResult, classesResult, sessionsResult, enrollmentsResult, paymentsResult] = await Promise.all([
    supabase.from('students').select('*').eq('branch_id', branchId).order('name'),
    supabase.from('coaches').select('*').eq('branch_id', branchId).order('name'),
    supabase.from('classes').select('*,coach:coaches(id,name)').eq('branch_id', branchId).order('day_of_week'),
    supabase.from('sessions').select('*,class:classes(id,label,start_time,end_time),coach:coaches(id,name)').eq('branch_id', branchId).gte('session_date', dayjs().subtract(12, 'month').format('YYYY-MM-DD')).lte('session_date', dayjs().add(12, 'month').format('YYYY-MM-DD')).order('session_date'),
    supabase.from('enrollments').select('*').eq('branch_id', branchId),
    includePayments
      ? supabase.from('payments').select('*,student:students(id,name,monthly_fee),coach:coaches(id,name)').eq('branch_id', branchId).order('fee_month', { ascending: false })
      : Promise.resolve({ data: [], error: null }),
  ])

  const results = [studentsResult, coachesResult, classesResult, sessionsResult, enrollmentsResult, paymentsResult]
  const error = results.find((result) => result.error)?.error
  if (error) throw new Error(error.message)

  return {
    students: (studentsResult.data || []) as Student[],
    coaches: (coachesResult.data || []) as Coach[],
    classes: (classesResult.data || []) as AcademyClass[],
    sessions: (sessionsResult.data || []) as Session[],
    enrollments: (enrollmentsResult.data || []) as Enrollment[],
    payments: (paymentsResult.data || []) as Payment[],
  }
}

export async function saveStudent(branchId: number, values: Partial<Student> & { name: string }) {
  const payload = { ...values, branch_id: branchId }
  if (values.id) return unwrap(await supabase.from('students').update(payload).eq('id', values.id).eq('branch_id', branchId).select().single()) as Student
  return unwrap(await supabase.from('students').insert(payload).select().single()) as Student
}

export async function saveStudentWithEnrollments(branchId: number, student: Partial<Student> & { name: string }, enrollments: Array<{ class_id: number; start_date: string }>, withdrawals: Array<{ class_id: number; end_date: string }>) {
  return unwrap(await supabase.rpc('save_student_with_enrollments', { p_branch_id: branchId, p_student: student, p_enrollments: enrollments, p_withdrawals: withdrawals })) as Student
}

export async function deleteStudent(branchId: number, id: number) {
  unwrap(await supabase.from('students').delete().eq('id', id).eq('branch_id', branchId))
}

export async function saveCoach(branchId: number, values: Partial<Coach> & { name: string }) {
  const payload = { ...values, branch_id: branchId }
  if (values.id) return unwrap(await supabase.from('coaches').update(payload).eq('id', values.id).eq('branch_id', branchId).select().single()) as Coach
  return unwrap(await supabase.from('coaches').insert(payload).select().single()) as Coach
}

export async function saveClass(branchId: number, values: Partial<AcademyClass> & { label: string; day_of_week: string }) {
  const { coach: _coach, ...fields } = values
  const payload = { ...fields, branch_id: branchId }
  if (values.id) return unwrap(await supabase.from('classes').update(payload).eq('id', values.id).eq('branch_id', branchId).select().single()) as AcademyClass
  return unwrap(await supabase.from('classes').insert(payload).select().single()) as AcademyClass
}

export async function deleteClass(branchId: number, id: number) {
  unwrap(await supabase.from('classes').delete().eq('id', id).eq('branch_id', branchId))
}

export async function deleteCoach(branchId: number, id: number) {
  unwrap(await supabase.from('coaches').delete().eq('id', id).eq('branch_id', branchId))
}

export async function saveEnrollment(studentId: number, classId: number, startDate: string) {
  return unwrap(await supabase.from('enrollments').upsert({ student_id: studentId, class_id: classId, start_date: startDate }).select().single()) as Enrollment
}

export async function deleteEnrollment(studentId: number, classId: number) {
  unwrap(await supabase.from('enrollments').delete().eq('student_id', studentId).eq('class_id', classId))
}

export async function generateSessions(classId: number, startDate: string, endDate: string) {
  return unwrap(await supabase.rpc('generate_sessions', { p_class_id: classId, p_start_date: startDate, p_end_date: endDate })) as number
}

export async function ensureTodaySession(academyClass: AcademyClass) {
  const today = dayjs().format('YYYY-MM-DD')
  const result = await supabase.from('sessions').upsert({
    branch_id: academyClass.branch_id,
    class_id: academyClass.id,
    session_date: today,
    coach_id: academyClass.coach_id,
  }, { onConflict: 'class_id,session_date', ignoreDuplicates: true }).select().maybeSingle()
  if (result.error) throw new Error(result.error.message)
  if (result.data) return result.data as Session
  return unwrap(await supabase.from('sessions').select('*').eq('class_id', academyClass.id).eq('session_date', today).single()) as Session
}

export async function getAttendance(sessionId: number) {
  return (unwrap(await supabase.from('attendance').select('*').eq('session_id', sessionId)) || []) as Attendance[]
}

export async function saveAttendance(record: Pick<Attendance, 'student_id' | 'session_id' | 'class_id' | 'branch_id' | 'attendance_date' | 'status' | 'remarks'>) {
  return unwrap(await supabase.from('attendance').upsert(record, { onConflict: 'student_id,session_id' }).select().single()) as Attendance
}

export async function setAttendanceStatus(studentId: number, sessionId: number, status: Attendance['status']) {
  return unwrap(await supabase.rpc('set_attendance_status', { p_student_id: studentId, p_session_id: sessionId, p_status: status })) as Attendance
}

export async function setAttendanceRemark(studentId: number, sessionId: number, remarks: string) {
  return unwrap(await supabase.rpc('set_attendance_remark', { p_student_id: studentId, p_session_id: sessionId, p_remarks: remarks })) as Attendance
}

export async function setAttendanceTrial(studentId: number, sessionId: number, isTrial: boolean) {
  return unwrap(await supabase.rpc('set_attendance_trial', { p_student_id: studentId, p_session_id: sessionId, p_is_trial: isTrial })) as Attendance
}

export async function markAllPresent(sessionId: number, studentIds: number[]) {
  return unwrap(await supabase.rpc('mark_all_present', { p_session_id: sessionId, p_student_ids: studentIds })) as Attendance[]
}

export async function removeAttendance(studentId: number, sessionId: number) {
  unwrap(await supabase.from('attendance').delete().eq('student_id', studentId).eq('session_id', sessionId))
}

export async function getCoachAttendance(sessionId: number) {
  return (unwrap(await supabase.from('coach_attendance').select('*').eq('session_id', sessionId)) || []) as CoachAttendance[]
}

export async function addCoachAttendance(sessionId: number, coachId: number) {
  return unwrap(await supabase.from('coach_attendance').insert({ session_id: sessionId, coach_id: coachId, hours: null }).select().single()) as CoachAttendance
}

export async function removeCoachAttendance(sessionId: number, coachId: number) {
  unwrap(await supabase.from('coach_attendance').delete().eq('session_id', sessionId).eq('coach_id', coachId))
}

export async function recordStudentPayment(input: {
  studentId: number
  feeMonths: string[]
  amount: number
  method: PaymentMethod
  status: PaymentStatus
  dateReceived: string
  remarks: string
  referenceNo: string
  coachId: number | null
  receiptPath: string | null
}) {
  return unwrap(await supabase.rpc('record_student_payment', {
    p_student_id: input.studentId,
    p_fee_months: input.feeMonths.map((month) => `${month}-01`),
    p_amount: input.amount,
    p_method: input.method,
    p_status: input.status,
    p_date_received: input.dateReceived,
    p_remarks: input.remarks,
    p_reference_no: input.referenceNo,
    p_coach_id: input.coachId,
    p_receipt_path: input.receiptPath,
  })) as number[]
}

export async function getCommission(coach: Coach, branchId: number, month: string) {
  const functionName = coach.coach_type === 'Head' ? 'get_head_coach_commission' : 'get_assistant_pay'
  const args = coach.coach_type === 'Head'
    ? { p_coach_id: coach.id, p_branch_id: branchId }
    : { p_coach_id: coach.id, p_branch_id: branchId, p_month: `${month}-01` }
  return unwrap(await supabase.rpc(functionName, args)) as CommissionSummary
}

export async function getCoachPayments(branchId: number, coachId: number) {
  return (unwrap(await supabase.from('coach_payments').select('*').eq('branch_id', branchId).eq('coach_id', coachId).order('date_paid', { ascending: false })) || []) as CoachPayment[]
}

export async function recordCoachPayout(input: {
  coachId: number
  amount: number
  units: number
  rate: number
  studentsCount: number
  datePaid: string
  remarks: string
  payMonth: string | null
}) {
  return unwrap(await supabase.rpc('record_coach_payout', {
    p_coach_id: input.coachId,
    p_amount: input.amount,
    p_units: input.units,
    p_rate: input.rate,
    p_students_count: input.studentsCount,
    p_date_paid: input.datePaid,
    p_remarks: input.remarks,
    p_pay_month: input.payMonth ? `${input.payMonth}-01` : null,
  })) as number
}

export async function undoCoachPayout(id: number) {
  unwrap(await supabase.rpc('undo_coach_payout', { p_coach_payment_id: id }))
}

export async function getHeadCoachRates() {
  return (unwrap(await supabase.from('head_coach_rates').select('*').order('min_students').order('min_fee')) || []) as HeadCoachRate[]
}

export async function replaceHeadCoachRates(rates: Omit<HeadCoachRate, 'id'>[]) {
  unwrap(await supabase.rpc('replace_head_coach_rates', { p_rates: rates }))
}

export async function saveBranch(values: Partial<Branch> & { name: string }) {
  if (values.id) return unwrap(await supabase.from('branches').update(values).eq('id', values.id).select().single()) as Branch
  return unwrap(await supabase.from('branches').insert(values).select().single()) as Branch
}

export async function updateAcademySettings(values: { academy_name?: string; logo_path?: string; default_branch_id?: number }) {
  return unwrap(await supabase.from('academy_settings').update(values).eq('singleton', true).select().single())
}

export async function getProfiles() {
  return (unwrap(await supabase.from('profiles').select('id,full_name,role').eq('login_kind', 'account').order('full_name')) || []) as Profile[]
}

export async function getBranchMemberships() {
  return (unwrap(await supabase.from('branch_memberships').select('user_id,branch_id')) || []) as Array<{ user_id: string; branch_id: number }>
}

export async function updateProfileAccess(userId: string, role: Profile['role'], branchIds: number[]) {
  unwrap(await supabase.rpc('update_profile_access', { p_user_id: userId, p_role: role, p_branch_ids: branchIds }))
}

export async function reconcileStudentEnrollments(studentId: number, enrollments: Array<{ class_id: number; start_date: string }>, withdrawals: Array<{ class_id: number; end_date: string }> = []) {
  unwrap(await supabase.rpc('reconcile_student_enrollments', { p_student_id: studentId, p_enrollments: enrollments, p_withdrawals: withdrawals }))
}

export async function getAttendanceReport(branchId: number, startDate: string, endDate: string) {
  return (unwrap(await supabase.from('attendance').select('*,student:students(id,name,status,gender,level),class:classes(id,label)').eq('branch_id', branchId).eq('status', 'Present').gte('attendance_date', startDate).lte('attendance_date', endDate).order('attendance_date')) || []) as Array<Attendance & {
    student: Pick<Student, 'id' | 'name' | 'status' | 'gender' | 'level'>
    class: Pick<AcademyClass, 'id' | 'label'>
  }>
}

export async function uploadImage(bucket: string, branchId: number, file: File, entityId?: number) {
  const profilePhoto = bucket === 'student-photos' || bucket === 'coach-photos'
  const prepared = await optimizeImage(file, bucket === 'payment-receipts' ? 2000 : 1600)
  const extension = prepared.type === 'image/webp' ? 'webp' : file.name.split('.').pop()?.toLowerCase() || 'jpg'
  const path = `${branchId}/${entityId || 'new'}/${crypto.randomUUID()}.${extension}`
  const result = await supabase.storage.from(bucket).upload(path, prepared, { upsert: false, contentType: prepared.type, cacheControl: '31536000' })
  if (result.error) throw new Error(result.error.message)
  if (profilePhoto) {
    try {
      const thumbnail = await createThumbnail(file)
      const thumbnailResult = await supabase.storage.from(bucket).upload(thumbnailPath(path), thumbnail, { upsert: true, contentType: 'image/webp', cacheControl: '31536000' })
      if (thumbnailResult.error) throw thumbnailResult.error
    } catch (error) {
      await supabase.storage.from(bucket).remove([path])
      throw new Error(error instanceof Error ? error.message : 'Could not create profile thumbnail')
    }
  }
  return result.data.path
}

export async function removeUploadedImage(bucket: string, path: string) {
  const paths = bucket === 'student-photos' || bucket === 'coach-photos' ? [path, thumbnailPath(path)] : [path]
  const { error } = await supabase.storage.from(bucket).remove(paths)
  if (error) throw new Error(error.message)
}

export async function removeReceiptIfUnreferenced(path: string) {
  const { count, error } = await supabase.from('payments').select('id', { count: 'exact', head: true }).eq('receipt_path', path)
  if (error) throw new Error(error.message)
  if (!count) await removeUploadedImage('payment-receipts', path)
}

async function optimizeImage(file: File, maxDimension: number) {
  if (!file.type.startsWith('image/') || file.type === 'image/svg+xml') return file
  const image = await createImageBitmap(file)
  const scale = Math.min(1, maxDimension / Math.max(image.width, image.height))
  if (scale === 1 && file.size <= 1_500_000) {
    image.close()
    return file
  }
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(image.width * scale))
  canvas.height = Math.max(1, Math.round(image.height * scale))
  canvas.getContext('2d')?.drawImage(image, 0, 0, canvas.width, canvas.height)
  image.close()
  return canvasFile(canvas, file.name, 0.84)
}

async function createThumbnail(file: File) {
  const image = await createImageBitmap(file)
  const side = Math.min(image.width, image.height)
  const sourceX = Math.round((image.width - side) / 2)
  const sourceY = Math.round((image.height - side) / 2)
  const canvas = document.createElement('canvas')
  canvas.width = 256
  canvas.height = 256
  canvas.getContext('2d')?.drawImage(image, sourceX, sourceY, side, side, 0, 0, 256, 256)
  image.close()
  return canvasFile(canvas, file.name, 0.78)
}

async function canvasFile(canvas: HTMLCanvasElement, fileName: string, quality: number) {
  const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((value) => value ? resolve(value) : reject(new Error('Could not resize image')), 'image/webp', quality))
  return new File([blob], fileName.replace(/\.[^.]+$/, '.webp'), { type: 'image/webp' })
}

export async function scanReceipt(file: File) {
  const body = new FormData()
  body.append('file', await optimizeImage(file, 2000))
  const result = await supabase.functions.invoke('receipt-ocr', { body })
  if (result.error) throw new Error(result.error.message)
  return result.data as {
    ok: boolean
    amount: number | null
    date: string | null
    method: PaymentMethod | null
    reference: string | null
    confidence: number | null
  }
}
