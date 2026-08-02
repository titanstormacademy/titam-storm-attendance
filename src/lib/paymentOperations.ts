import { supabase, signedReceiptUrl } from './supabase'
import type { Payment, PaymentMethod, PaymentStatus } from '../types/models'

export async function updatePayment(branchId: number, id: number, input: {
  student_id: number
  fee_month: string
  amount: number
  method: PaymentMethod
  status: PaymentStatus
  date_received: string
  remarks: string
  reference_no: string
  coach_id: number | null
  receipt_path: string | null
}) {
  const currentResult = await supabase.from('payments').select('student_id,fee_month,status,coach_id,commission_settled').eq('id', id).eq('branch_id', branchId).single()
  if (currentResult.error) throw new Error(currentResult.error.message)
  const current = currentResult.data
  const nextMonth = `${input.fee_month}-01`
  if (current.commission_settled && (current.student_id !== input.student_id || current.fee_month !== nextMonth || current.status !== input.status || current.coach_id !== input.coach_id)) {
    throw new Error('Undo the linked coach payout before changing the student, fee month, status, or coach.')
  }
  const { data, error } = await supabase.from('payments').update({ ...input, reference_no: input.reference_no.trim(), fee_month: nextMonth }).eq('id', id).eq('branch_id', branchId).select().single()
  if (error) throw new Error(error.message)
  return data as Payment
}

export async function deletePayment(branchId: number, payment: Payment) {
  if (payment.commission_settled || payment.coach_payment_id) throw new Error('Undo the linked coach payout before deleting this settled payment.')
  const { error } = await supabase.from('payments').delete().eq('id', payment.id).eq('branch_id', branchId)
  if (error) throw new Error(error.message)
}

export async function findDuplicateReference(branchId: number, reference: string, excludeId?: number) {
  if (!reference.trim()) return null
  let query = supabase.from('payments').select('id,fee_month,amount,student:students(name)').eq('branch_id', branchId).ilike('reference_no', reference.trim().replace(/[\\%_]/g, '\\$&'))
  if (excludeId) query = query.neq('id', excludeId)
  const { data, error } = await query.limit(1).maybeSingle()
  if (error) throw new Error(error.message)
  return data as unknown as { id: number; fee_month: string; amount: number; student: { name: string } | null } | null
}

export async function openReceipt(path: string) {
  window.open(await signedReceiptUrl(path), '_blank', 'noopener,noreferrer')
}
