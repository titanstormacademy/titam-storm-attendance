export type Role = 'admin' | 'staff'
export type StudentStatus = 'Active' | 'Trial' | 'Inactive'
export type CoachType = 'Head' | 'Assistant'
export type PaymentStatus = 'Paid' | 'Partial' | 'Unpaid'
export type PaymentMethod = 'Cash' | 'Bank Transfer' | "Touch 'n Go eWallet" | 'Online' | 'Others'

export interface Profile {
  id: string
  full_name: string
  role: Role
}

export interface Branch {
  id: number
  name: string
  subtitle: string
  status: 'Active' | 'Inactive'
}

export interface Student {
  id: number
  branch_id: number
  name: string
  nric: string
  gender: '' | 'Male' | 'Female'
  date_of_birth: string | null
  school: string
  student_phone: string
  parent_name: string
  parent_contact: string
  email: string
  monthly_fee: number | null
  level: '' | 'Beginner' | 'Intermediate' | 'Advanced'
  status: StudentStatus
  photo_path: string | null
  created_at: string
}

export interface Coach {
  id: number
  branch_id: number
  name: string
  phone: string
  coach_type: CoachType
  hourly_rate: number
  status: 'Active' | 'Inactive'
  photo_path: string | null
}

export interface AcademyClass {
  id: number
  branch_id: number
  label: string
  day_of_week: string
  start_time: string | null
  end_time: string | null
  coach_id: number | null
  coach?: Pick<Coach, 'id' | 'name'> | null
}

export interface Session {
  id: number
  branch_id: number
  class_id: number
  session_date: string
  notes: string
  coach_id: number | null
  class?: Pick<AcademyClass, 'id' | 'label' | 'start_time' | 'end_time'>
  coach?: Pick<Coach, 'id' | 'name'> | null
}

export interface Enrollment {
  id: number
  branch_id: number
  student_id: number
  class_id: number
  start_date: string
}

export interface Attendance {
  student_id: number
  session_id: number
  class_id: number
  branch_id: number
  attendance_date: string
  status: '' | 'Present'
  remarks: string
}

export interface CoachAttendance {
  id: number
  session_id: number
  coach_id: number
  hours: number
}

export interface Payment {
  id: number
  branch_id: number
  student_id: number
  fee_month: string
  amount: number
  method: PaymentMethod | null
  status: PaymentStatus
  date_received: string | null
  remarks: string
  reference_no: string
  coach_id: number | null
  commission_settled: boolean
  coach_payment_id: number | null
  receipt_path: string | null
  student?: Pick<Student, 'id' | 'name' | 'monthly_fee'>
  coach?: Pick<Coach, 'id' | 'name'> | null
}

export interface CoachPayment {
  id: number
  coach_id: number
  payout_type: CoachType
  pay_month: string | null
  amount: number
  units: number
  rate: number
  students_count: number
  date_paid: string
  remarks: string
}

export interface HeadCoachRate {
  id: number
  min_students: number
  max_students: number
  min_fee: number
  max_fee: number
  payout: number
}

export interface CommissionSummary {
  type: CoachType
  units?: number
  students?: number
  commission?: number
  unmatched?: number
  items?: Array<{
    paymentId: number
    studentId: number
    studentName: string
    feeMonth: string
    dateReceived: string | null
    receivedMonth: string | null
    fee: number | null
    payout: number
  }>
  month?: string
  hours?: number
  hourlyRate?: number
  total?: number
  sessions?: Array<{ date: string; className: string; hours: number }>
}

export interface BootstrapData {
  students: Student[]
  coaches: Coach[]
  classes: AcademyClass[]
  sessions: Session[]
  enrollments: Enrollment[]
  payments: Payment[]
}
