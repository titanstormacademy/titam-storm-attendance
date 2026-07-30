create or replace function public.replace_legacy_data(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_table regclass;
  v_max bigint;
begin
  if coalesce(auth.jwt() ->> 'role', '') <> 'service_role' then
    raise exception 'Service-role access required';
  end if;
  if jsonb_typeof(p_payload) <> 'object' then
    raise exception 'Import payload must be a JSON object';
  end if;

  delete from public.coach_payment_lines where id is not null;
  delete from public.payments where id is not null;
  delete from public.coach_payments where id is not null;
  delete from public.coach_attendance where id is not null;
  delete from public.attendance where student_id is not null;
  delete from public.enrollments where id is not null;
  delete from public.sessions where id is not null;
  delete from public.classes where id is not null;
  delete from public.coaches where id is not null;
  delete from public.students where id is not null;

  insert into public.branches (id, name, subtitle, status, created_at)
  select id, name, coalesce(subtitle, ''), coalesce(status, 'Active'), coalesce(created_at, now())
  from jsonb_to_recordset(coalesce(p_payload -> 'branches', '[]'::jsonb)) as rows(
    id bigint,
    name text,
    subtitle text,
    status text,
    created_at timestamptz
  )
  on conflict (id) do update set
    name = excluded.name,
    subtitle = excluded.subtitle,
    status = excluded.status,
    updated_at = now();

  update public.branches
  set status = 'Inactive', updated_at = now()
  where id not in (select value::bigint from jsonb_array_elements_text(coalesce(p_payload -> 'branch_ids', '[]'::jsonb)));

  insert into public.students (
    id, branch_id, name, nric, gender, date_of_birth, height, school,
    tshirt_size, student_phone, parent_name, parent_contact, email,
    father_height, mother_height, monthly_fee, level, status, photo_path, created_at
  )
  select
    id, branch_id, name, coalesce(nric, ''), coalesce(gender, ''), date_of_birth,
    coalesce(height, ''), coalesce(school, ''), coalesce(tshirt_size, ''),
    coalesce(student_phone, ''), coalesce(parent_name, ''), coalesce(parent_contact, ''),
    coalesce(email, ''), coalesce(father_height, ''), coalesce(mother_height, ''),
    monthly_fee, coalesce(level, ''), coalesce(status, 'Active'), photo_path,
    coalesce(created_at, now())
  from jsonb_to_recordset(coalesce(p_payload -> 'students', '[]'::jsonb)) as rows(
    id bigint,
    branch_id bigint,
    name text,
    nric text,
    gender text,
    date_of_birth date,
    height text,
    school text,
    tshirt_size text,
    student_phone text,
    parent_name text,
    parent_contact text,
    email text,
    father_height text,
    mother_height text,
    monthly_fee numeric,
    level text,
    status public.record_status,
    photo_path text,
    created_at timestamptz
  );

  insert into public.coaches (
    id, branch_id, name, phone, coach_type, hourly_rate, status, photo_path, created_at
  )
  select
    id, branch_id, name, coalesce(phone, ''), coalesce(coach_type, 'Head'),
    coalesce(hourly_rate, 0), coalesce(status, 'Active'), photo_path, coalesce(created_at, now())
  from jsonb_to_recordset(coalesce(p_payload -> 'coaches', '[]'::jsonb)) as rows(
    id bigint,
    branch_id bigint,
    name text,
    phone text,
    coach_type public.coach_type,
    hourly_rate numeric,
    status text,
    photo_path text,
    created_at timestamptz
  );

  insert into public.classes (id, branch_id, label, day_of_week, start_time, end_time, coach_id)
  select id, branch_id, label, day_of_week, start_time, end_time, coach_id
  from jsonb_to_recordset(coalesce(p_payload -> 'classes', '[]'::jsonb)) as rows(
    id bigint,
    branch_id bigint,
    label text,
    day_of_week text,
    start_time time,
    end_time time,
    coach_id bigint
  );

  insert into public.sessions (id, branch_id, class_id, session_date, notes, coach_id)
  select id, branch_id, class_id, session_date, coalesce(notes, ''), coach_id
  from jsonb_to_recordset(coalesce(p_payload -> 'sessions', '[]'::jsonb)) as rows(
    id bigint,
    branch_id bigint,
    class_id bigint,
    session_date date,
    notes text,
    coach_id bigint
  );

  insert into public.enrollments (id, branch_id, student_id, class_id, start_date)
  select id, branch_id, student_id, class_id, start_date
  from jsonb_to_recordset(coalesce(p_payload -> 'enrollments', '[]'::jsonb)) as rows(
    id bigint,
    branch_id bigint,
    student_id bigint,
    class_id bigint,
    start_date date
  );

  insert into public.coach_payments (
    id, branch_id, coach_id, payout_type, pay_month, amount, units, rate,
    students_count, date_paid, remarks
  )
  select
    id, branch_id, coach_id, payout_type, pay_month, amount, units, rate,
    students_count, date_paid, coalesce(remarks, '')
  from jsonb_to_recordset(coalesce(p_payload -> 'coach_payments', '[]'::jsonb)) as rows(
    id bigint,
    branch_id bigint,
    coach_id bigint,
    payout_type public.payout_type,
    pay_month date,
    amount numeric,
    units numeric,
    rate numeric,
    students_count integer,
    date_paid date,
    remarks text
  );

  insert into public.payments (
    id, branch_id, student_id, fee_month, amount, method, status,
    date_received, remarks, reference_no, coach_id, commission_settled,
    coach_payment_id, receipt_path
  )
  select
    id, branch_id, student_id, fee_month, amount, method, status,
    date_received, coalesce(remarks, ''), coalesce(reference_no, ''), coach_id,
    coalesce(commission_settled, false), coach_payment_id, receipt_path
  from jsonb_to_recordset(coalesce(p_payload -> 'payments', '[]'::jsonb)) as rows(
    id bigint,
    branch_id bigint,
    student_id bigint,
    fee_month date,
    amount numeric,
    method public.payment_method,
    status public.payment_status,
    date_received date,
    remarks text,
    reference_no text,
    coach_id bigint,
    commission_settled boolean,
    coach_payment_id bigint,
    receipt_path text
  );

  insert into public.attendance (
    student_id, session_id, class_id, branch_id, attendance_date, status, remarks
  )
  select
    student_id, session_id, class_id, branch_id, attendance_date,
    coalesce(status, ''), coalesce(remarks, '')
  from jsonb_to_recordset(coalesce(p_payload -> 'attendance', '[]'::jsonb)) as rows(
    student_id bigint,
    session_id bigint,
    class_id bigint,
    branch_id bigint,
    attendance_date date,
    status text,
    remarks text
  );

  insert into public.coach_attendance (
    id, branch_id, session_id, class_id, attendance_date, coach_id, hours
  )
  select id, branch_id, session_id, class_id, attendance_date, coach_id, hours
  from jsonb_to_recordset(coalesce(p_payload -> 'coach_attendance', '[]'::jsonb)) as rows(
    id bigint,
    branch_id bigint,
    session_id bigint,
    class_id bigint,
    attendance_date date,
    coach_id bigint,
    hours numeric
  );

  delete from public.head_coach_rates where id is not null;
  insert into public.head_coach_rates (min_students, max_students, min_fee, max_fee, payout)
  select min_students, max_students, min_fee, max_fee, payout
  from jsonb_to_recordset(coalesce(p_payload -> 'head_coach_rates', '[]'::jsonb)) as rows(
    min_students integer,
    max_students integer,
    min_fee numeric,
    max_fee numeric,
    payout numeric
  );

  update public.academy_settings
  set
    academy_name = coalesce(p_payload #>> '{settings,academy_name}', academy_name),
    default_branch_id = coalesce((p_payload #>> '{settings,default_branch_id}')::bigint, default_branch_id),
    logo_path = coalesce(p_payload #>> '{settings,logo_path}', logo_path),
    updated_at = now()
  where singleton;

  for v_table in
    select unnest(array[
      'public.branches'::regclass,
      'public.students'::regclass,
      'public.coaches'::regclass,
      'public.classes'::regclass,
      'public.sessions'::regclass,
      'public.enrollments'::regclass,
      'public.payments'::regclass,
      'public.coach_payments'::regclass,
      'public.coach_attendance'::regclass,
      'public.head_coach_rates'::regclass
    ])
  loop
    execute format('select coalesce(max(id), 0) from %s', v_table) into v_max;
    perform setval(pg_get_serial_sequence(v_table::text, 'id'), greatest(v_max, 1), v_max > 0);
  end loop;

  return jsonb_build_object(
    'branches', (select count(*) from public.branches where status = 'Active'),
    'students', (select count(*) from public.students),
    'coaches', (select count(*) from public.coaches),
    'classes', (select count(*) from public.classes),
    'sessions', (select count(*) from public.sessions),
    'enrollments', (select count(*) from public.enrollments),
    'attendance', (select count(*) from public.attendance),
    'payments', (select count(*) from public.payments),
    'coachPayments', (select count(*) from public.coach_payments),
    'coachAttendance', (select count(*) from public.coach_attendance)
  );
end;
$$;

revoke all on function public.replace_legacy_data(jsonb) from public;
grant execute on function public.replace_legacy_data(jsonb) to service_role;
