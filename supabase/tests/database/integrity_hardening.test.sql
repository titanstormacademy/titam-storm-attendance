begin;
create extension if not exists pgtap with schema extensions;
select plan(29);

insert into auth.users (id, email) values ('00000000-0000-4000-8000-000000000001', 'admin@example.test');
select is((select role::text from public.profiles where id = '00000000-0000-4000-8000-000000000001'), 'staff', 'new accounts always start as staff');
update public.profiles set role = 'admin' where id = '00000000-0000-4000-8000-000000000001';
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-000000000001","role":"authenticated"}', true);

insert into public.students (id, branch_id, name, status, monthly_fee) values
  (9001, 1, 'Temporal Student', 'Active', 150),
  (9002, 1, 'Inactive Student', 'Inactive', 150);
insert into public.coaches (id, branch_id, name, coach_type, hourly_rate) values
  (9001, 1, 'Head Coach', 'Head', 0),
  (9002, 1, 'Assistant Coach', 'Assistant', 100);
insert into public.classes (id, branch_id, label, day_of_week, start_time, end_time, coach_id)
values (9001, 1, 'Integrity Class', trim(to_char(current_date, 'Day')), '09:00', '10:30', 9001);
insert into public.sessions (id, branch_id, class_id, session_date, coach_id) values (9001, 1, 9001, current_date, 9001);

select lives_ok(
  $$select public.save_student_with_enrollments(1, '{"id":9001,"name":"Temporal Student","status":"Active","monthly_fee":150,"age":0}'::jsonb, '[]'::jsonb, '[]'::jsonb)$$,
  'manual student age can be saved'
);
select is((select age::integer from public.students where id = 9001), 0, 'manual age preserves zero');
select lives_ok(
  $$select public.save_student_with_enrollments(1, '{"id":9001,"name":"Temporal Student","status":"Active","monthly_fee":150,"age":12,"date_of_birth":"2015-08-01"}'::jsonb, '[]'::jsonb, '[]'::jsonb)$$,
  'date of birth can replace manual age'
);
select is((select age::integer from public.students where id = 9001), null, 'date of birth clears stored manual age');
select throws_ok(
  format($$select public.save_student_with_enrollments(1, '{"id":9001,"name":"Temporal Student","status":"Active","date_of_birth":"%s"}'::jsonb, '[]'::jsonb, '[]'::jsonb)$$, (current_date + 1)::text),
  'P0001',
  'Date of birth cannot be in the future',
  'future date of birth is rejected'
);

select lives_ok(
  $$select public.reconcile_student_enrollments(9001, '[{"class_id":9001,"start_date":"2026-01-01"}]'::jsonb, '[]'::jsonb)$$,
  'student can be enrolled'
);
select lives_ok(
  $$select public.reconcile_student_enrollments(9001, '[]'::jsonb, '[{"class_id":9001,"end_date":"2026-03-31"}]'::jsonb)$$,
  'withdrawal closes rather than deletes an enrollment'
);
select is((select count(*)::integer from public.enrollments where student_id = 9001 and class_id = 9001), 1, 'withdrawal preserves the historical row');
select is((select end_date::text from public.enrollments where student_id = 9001 and class_id = 9001), '2026-03-31', 'chosen withdrawal date is preserved');
select lives_ok(
  $$select public.reconcile_student_enrollments(9001, '[{"class_id":9001,"start_date":"2026-05-01"}]'::jsonb, '[]'::jsonb)$$,
  'student can re-enroll after a closed period'
);
select is((select count(*)::integer from public.enrollments where student_id = 9001 and class_id = 9001), 2, 're-enrollment creates a second period');
select throws_ok(
  format($$select public.reconcile_student_enrollments(9001, '[]'::jsonb, '[{"class_id":9001,"end_date":"%s"}]'::jsonb)$$, (current_date + 1)::text),
  'P0001',
  'Every withdrawal requires a valid same-branch class and end date no later than today',
  'future withdrawals are rejected'
);
select throws_ok(
  $$select public.save_student_with_enrollments(1, '{"id":9001,"name":"Should Roll Back","status":"Active"}'::jsonb, '[]'::jsonb, '[{"class_id":9001,"end_date":"2025-01-01"}]'::jsonb)$$,
  'P0001',
  'Withdrawal date cannot be before the enrollment start date',
  'student and enrollment changes fail in one transaction'
);
select is((select name from public.students where id = 9001), 'Temporal Student', 'failed enrollment reconciliation rolls back the student update');
select throws_ok(
  $$insert into public.enrollments (branch_id, student_id, class_id, start_date, end_date) values (1, 9001, 9001, '2026-02-01', '2026-02-15')$$,
  '23P01',
  null,
  'overlapping enrollment periods are rejected'
);

select throws_ok(
  $$insert into public.payments (branch_id, student_id, fee_month, amount, status, coach_id) values (1, 9001, '2026-01-01', 150, 'Paid', 9002)$$,
  'P0001',
  'Only head coaches can receive student-payment commission',
  'assistant coach cannot be assigned payment commission'
);

select lives_ok($$select public.set_attendance_remark(9001, 9001, 'Arrived early')$$, 'attendance remark can be saved independently');
select lives_ok($$select public.set_attendance_status(9001, 9001, 'Present')$$, 'attendance status can be saved independently');
select is((select remarks from public.attendance where student_id = 9001 and session_id = 9001), 'Arrived early', 'status update does not overwrite remarks');
select throws_ok(
  $$select * from public.mark_all_present(9001, array[9002]::bigint[])$$,
  'P0001',
  'All-present contains an ineligible student',
  'all-present rejects inactive or unenrolled students'
);

insert into public.coach_attendance (branch_id, session_id, class_id, attendance_date, coach_id, hours)
values (1, 9001, 9001, current_date, 9002, 1.5);
select lives_ok(
  format($$select public.record_coach_payout(9002, 150, 1.5, 100, 0, current_date, '', %L::date)$$, date_trunc('month', current_date)::date),
  'assistant payout settles the month once'
);
select throws_ok(
  format($$select public.record_coach_payout(9002, 150, 1.5, 100, 0, current_date, '', %L::date)$$, date_trunc('month', current_date)::date),
  'P0001',
  'This assistant month is already settled',
  'duplicate assistant month payout is rejected'
);
select ok(exists(select 1 from pg_policies where schemaname = 'public' and tablename = 'attendance' and policyname = 'attendance_today_delete'), 'basic users have a current-day attendance delete policy');
select ok(exists(select 1 from pg_policies where schemaname = 'public' and tablename = 'sessions' and policyname = 'sessions_today_read'), 'non-admin session reads are limited to today');
select ok(exists(select 1 from pg_policies where schemaname = 'public' and tablename = 'attendance' and policyname = 'attendance_today_read'), 'non-admin attendance reads are limited to today');
select ok(exists(select 1 from pg_policies where schemaname = 'public' and tablename = 'coach_attendance' and policyname = 'coach_attendance_today_read'), 'non-admin coach attendance reads are limited to today');
select ok(not exists(select 1 from pg_indexes where schemaname = 'public' and indexname = 'payments_one_paid_student_month_idx'), 'upgrade does not require historical paid rows to already be unique');
select ok(exists(select 1 from pg_trigger where tgname = 'payments_prevent_duplicate_paid_month' and not tgisinternal), 'future duplicate paid student-month rows are blocked by a trigger');

select * from finish();
rollback;
