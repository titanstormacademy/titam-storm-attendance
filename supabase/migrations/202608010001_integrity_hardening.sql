create extension if not exists btree_gist with schema extensions;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, full_name, role)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', split_part(coalesce(new.email, ''), '@', 1)),
    'staff'::public.app_role
  );
  return new;
end;
$$;

alter table public.enrollments add column if not exists end_date date;
alter table public.enrollments drop constraint if exists enrollments_student_id_class_id_key;
alter table public.enrollments drop constraint if exists enrollments_valid_dates;
alter table public.enrollments add constraint enrollments_valid_dates check (end_date is null or end_date >= start_date);
create unique index if not exists enrollments_one_active_idx on public.enrollments(student_id, class_id) where end_date is null;
set search_path = public, extensions;
alter table public.enrollments drop constraint if exists enrollments_no_overlap;
alter table public.enrollments add constraint enrollments_no_overlap exclude using gist (
  student_id with =,
  class_id with =,
  daterange(start_date, coalesce(end_date, 'infinity'::date), '[]') with &&
);
reset search_path;

alter table public.sessions drop constraint if exists sessions_class_id_fkey;
alter table public.sessions add constraint sessions_class_id_fkey foreign key (class_id) references public.classes(id) on delete restrict;
alter table public.enrollments drop constraint if exists enrollments_class_id_fkey;
alter table public.enrollments add constraint enrollments_class_id_fkey foreign key (class_id) references public.classes(id) on delete restrict;
alter table public.attendance drop constraint if exists attendance_class_id_fkey;
alter table public.attendance add constraint attendance_class_id_fkey foreign key (class_id) references public.classes(id) on delete restrict;
alter table public.coach_attendance drop constraint if exists coach_attendance_class_id_fkey;
alter table public.coach_attendance add constraint coach_attendance_class_id_fkey foreign key (class_id) references public.classes(id) on delete restrict;

create or replace function public.prevent_branch_transfer()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.branch_id is distinct from old.branch_id then
    raise exception 'Branch transfers require a dedicated migration';
  end if;
  return new;
end;
$$;

create trigger students_prevent_branch_transfer before update of branch_id on public.students for each row execute function public.prevent_branch_transfer();
create trigger coaches_prevent_branch_transfer before update of branch_id on public.coaches for each row execute function public.prevent_branch_transfer();
create trigger classes_prevent_branch_transfer before update of branch_id on public.classes for each row execute function public.prevent_branch_transfer();

drop function if exists public.reconcile_student_enrollments(bigint, jsonb);
create or replace function public.reconcile_student_enrollments(
  p_student_id bigint,
  p_enrollments jsonb,
  p_withdrawals jsonb default '[]'::jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_branch bigint;
begin
  if not public.is_admin() then raise exception 'Admin access required'; end if;
  select branch_id into strict v_branch from public.students where id = p_student_id for update;
  if not public.can_access_branch(v_branch) then raise exception 'Branch access denied'; end if;
  if jsonb_typeof(coalesce(p_enrollments, '[]'::jsonb)) <> 'array' or jsonb_typeof(coalesce(p_withdrawals, '[]'::jsonb)) <> 'array' then
    raise exception 'Enrollment changes must be arrays';
  end if;
  if exists(
    select 1 from jsonb_to_recordset(coalesce(p_enrollments, '[]'::jsonb)) as rows(class_id bigint, start_date date)
    left join public.classes c on c.id = rows.class_id
    where rows.class_id is null or rows.start_date is null or c.id is null or c.branch_id <> v_branch
  ) then raise exception 'Every active enrollment requires a valid same-branch class and start date'; end if;
  if exists(
    select 1 from jsonb_to_recordset(coalesce(p_withdrawals, '[]'::jsonb)) as rows(class_id bigint, end_date date)
    left join public.classes c on c.id = rows.class_id
    where rows.class_id is null or rows.end_date is null or rows.end_date > current_date or c.id is null or c.branch_id <> v_branch
  ) then raise exception 'Every withdrawal requires a valid same-branch class and end date no later than today'; end if;
  if exists(
    select 1
    from jsonb_to_recordset(coalesce(p_enrollments, '[]'::jsonb)) as active_rows(class_id bigint, start_date date)
    join jsonb_to_recordset(coalesce(p_withdrawals, '[]'::jsonb)) as withdrawal_rows(class_id bigint, end_date date) using (class_id)
  ) then raise exception 'A class cannot be activated and withdrawn in the same save'; end if;
  if exists(
    select rows.class_id from jsonb_to_recordset(coalesce(p_enrollments, '[]'::jsonb)) as rows(class_id bigint, start_date date)
    group by rows.class_id having count(*) > 1
  ) or exists(
    select rows.class_id from jsonb_to_recordset(coalesce(p_withdrawals, '[]'::jsonb)) as rows(class_id bigint, end_date date)
    group by rows.class_id having count(*) > 1
  ) then raise exception 'Duplicate class changes are not allowed'; end if;
  if exists(
    select 1
    from public.enrollments e
    join jsonb_to_recordset(coalesce(p_withdrawals, '[]'::jsonb)) as rows(class_id bigint, end_date date) on rows.class_id = e.class_id
    where e.student_id = p_student_id and e.end_date is null and rows.end_date < e.start_date
  ) then raise exception 'Withdrawal date cannot be before the enrollment start date'; end if;
  if exists(
    select 1 from jsonb_to_recordset(coalesce(p_withdrawals, '[]'::jsonb)) as rows(class_id bigint, end_date date)
    where not exists(select 1 from public.enrollments e where e.student_id = p_student_id and e.class_id = rows.class_id and e.end_date is null)
  ) then raise exception 'No active enrollment exists for one or more withdrawals'; end if;
  if exists(
    select 1 from public.enrollments e
    where e.student_id = p_student_id and e.end_date is null
      and not exists(select 1 from jsonb_to_recordset(coalesce(p_enrollments, '[]'::jsonb)) as rows(class_id bigint, start_date date) where rows.class_id = e.class_id)
      and not exists(select 1 from jsonb_to_recordset(coalesce(p_withdrawals, '[]'::jsonb)) as rows(class_id bigint, end_date date) where rows.class_id = e.class_id)
  ) then raise exception 'Choose a withdrawal date for every removed class'; end if;

  update public.enrollments e
  set end_date = rows.end_date
  from jsonb_to_recordset(coalesce(p_withdrawals, '[]'::jsonb)) as rows(class_id bigint, end_date date)
  where e.student_id = p_student_id and e.class_id = rows.class_id and e.end_date is null;

  update public.enrollments e
  set start_date = rows.start_date
  from jsonb_to_recordset(coalesce(p_enrollments, '[]'::jsonb)) as rows(class_id bigint, start_date date)
  where e.student_id = p_student_id and e.class_id = rows.class_id and e.end_date is null;

  insert into public.enrollments (student_id, class_id, start_date, branch_id)
  select p_student_id, rows.class_id, rows.start_date, v_branch
  from jsonb_to_recordset(coalesce(p_enrollments, '[]'::jsonb)) as rows(class_id bigint, start_date date)
  where not exists(select 1 from public.enrollments e where e.student_id = p_student_id and e.class_id = rows.class_id and e.end_date is null);
end;
$$;

create or replace function public.save_student_with_enrollments(
  p_branch_id bigint,
  p_student jsonb,
  p_enrollments jsonb,
  p_withdrawals jsonb default '[]'::jsonb
)
returns public.students
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id bigint := nullif(p_student ->> 'id', '')::bigint;
  v_student public.students%rowtype;
begin
  if not public.is_admin() then raise exception 'Admin access required'; end if;
  if not public.can_access_branch(p_branch_id) then raise exception 'Branch access denied'; end if;
  if btrim(coalesce(p_student ->> 'name', '')) = '' then raise exception 'Student name is required'; end if;
  if v_id is null then
    insert into public.students (
      branch_id, name, nric, gender, date_of_birth, height, school, tshirt_size, student_phone,
      parent_name, parent_contact, email, father_height, mother_height, monthly_fee, level, status, photo_path
    ) values (
      p_branch_id, btrim(p_student ->> 'name'), coalesce(p_student ->> 'nric', ''), coalesce(p_student ->> 'gender', ''), nullif(p_student ->> 'date_of_birth', '')::date,
      coalesce(p_student ->> 'height', ''), coalesce(p_student ->> 'school', ''), coalesce(p_student ->> 'tshirt_size', ''), coalesce(p_student ->> 'student_phone', ''),
      coalesce(p_student ->> 'parent_name', ''), coalesce(p_student ->> 'parent_contact', ''), coalesce(p_student ->> 'email', ''), coalesce(p_student ->> 'father_height', ''),
      coalesce(p_student ->> 'mother_height', ''), nullif(p_student ->> 'monthly_fee', '')::numeric, coalesce(p_student ->> 'level', ''),
      coalesce(nullif(p_student ->> 'status', '')::public.record_status, 'Active'::public.record_status), nullif(p_student ->> 'photo_path', '')
    ) returning * into v_student;
  else
    update public.students set
      name = btrim(p_student ->> 'name'), nric = coalesce(p_student ->> 'nric', ''), gender = coalesce(p_student ->> 'gender', ''),
      date_of_birth = nullif(p_student ->> 'date_of_birth', '')::date, height = coalesce(p_student ->> 'height', ''), school = coalesce(p_student ->> 'school', ''),
      tshirt_size = coalesce(p_student ->> 'tshirt_size', ''), student_phone = coalesce(p_student ->> 'student_phone', ''), parent_name = coalesce(p_student ->> 'parent_name', ''),
      parent_contact = coalesce(p_student ->> 'parent_contact', ''), email = coalesce(p_student ->> 'email', ''), father_height = coalesce(p_student ->> 'father_height', ''),
      mother_height = coalesce(p_student ->> 'mother_height', ''), monthly_fee = nullif(p_student ->> 'monthly_fee', '')::numeric, level = coalesce(p_student ->> 'level', ''),
      status = coalesce(nullif(p_student ->> 'status', '')::public.record_status, status), photo_path = nullif(p_student ->> 'photo_path', '')
    where id = v_id and branch_id = p_branch_id
    returning * into v_student;
    if not found then raise exception 'Student not found in the selected branch'; end if;
  end if;
  perform public.reconcile_student_enrollments(v_student.id, p_enrollments, p_withdrawals);
  return v_student;
end;
$$;

create or replace function public.sync_payment_fields()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_student_branch bigint;
  v_coach_branch bigint;
  v_coach_type public.coach_type;
begin
  select branch_id into strict v_student_branch from public.students where id = new.student_id;
  new.branch_id = v_student_branch;
  if new.coach_id is not null then
    select branch_id, coach_type into strict v_coach_branch, v_coach_type from public.coaches where id = new.coach_id;
    if v_coach_branch is distinct from v_student_branch then raise exception 'Coach must belong to the same branch'; end if;
    if v_coach_type <> 'Head' then raise exception 'Only head coaches can receive student-payment commission'; end if;
  end if;
  return new;
end;
$$;

create or replace function public.record_student_payment(
  p_student_id bigint,
  p_fee_months date[],
  p_amount numeric,
  p_method public.payment_method,
  p_status public.payment_status,
  p_date_received date,
  p_remarks text default '',
  p_reference_no text default '',
  p_coach_id bigint default null,
  p_receipt_path text default null
)
returns bigint[]
language plpgsql
security definer
set search_path = public
as $$
declare
  v_branch bigint;
  v_primary date;
  v_month date;
  v_id bigint;
  v_ids bigint[] := '{}'::bigint[];
begin
  if not public.is_admin() then raise exception 'Admin access required'; end if;
  if coalesce(array_length(p_fee_months, 1), 0) = 0 then raise exception 'At least one fee month is required'; end if;
  select branch_id into strict v_branch from public.students where id = p_student_id;
  if not public.can_access_branch(v_branch) then raise exception 'Branch access denied'; end if;
  select max(date_trunc('month', month_value)::date) into v_primary from unnest(p_fee_months) as months(month_value);
  foreach v_month in array p_fee_months loop
    v_month = date_trunc('month', v_month)::date;
    insert into public.payments (
      branch_id, student_id, fee_month, amount, method, status, date_received,
      remarks, reference_no, coach_id, receipt_path
    ) values (
      v_branch, p_student_id, v_month, case when v_month = v_primary then p_amount else 0 end,
      p_method, p_status, p_date_received,
      case
        when v_month = v_primary then coalesce(p_remarks, '')
        when btrim(coalesce(p_remarks, '')) = '' then 'Paid in ' || to_char(v_primary, 'FMMonth YYYY')
        else p_remarks || ' · Paid in ' || to_char(v_primary, 'FMMonth YYYY')
      end,
      case when v_month = v_primary then btrim(coalesce(p_reference_no, '')) else '' end,
      p_coach_id, p_receipt_path
    ) returning id into v_id;
    v_ids = array_append(v_ids, v_id);
  end loop;
  return v_ids;
end;
$$;

create or replace function public.prevent_duplicate_paid_student_month()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.status = 'Paid' and exists(
    select 1 from public.payments p
    where p.student_id = new.student_id and p.fee_month = new.fee_month and p.status = 'Paid' and p.id <> new.id
  ) then raise exception 'A paid record already exists for this student and fee month'; end if;
  return new;
end;
$$;

create trigger payments_prevent_duplicate_paid_month before insert or update on public.payments for each row execute function public.prevent_duplicate_paid_student_month();
create unique index if not exists coach_payment_lines_payment_unique_idx on public.coach_payment_lines(payment_id);

alter table public.coach_attendance add column if not exists coach_payment_id bigint references public.coach_payments(id) on delete set null;
create or replace function public.sync_coach_payment_fields()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_branch bigint;
  v_type public.coach_type;
begin
  select branch_id, coach_type into strict v_branch, v_type from public.coaches where id = new.coach_id;
  new.branch_id = v_branch;
  new.payout_type = v_type::text::public.payout_type;
  new.pay_month = case when v_type = 'Assistant' then date_trunc('month', coalesce(new.pay_month, new.date_paid))::date else null end;
  return new;
end;
$$;
update public.coach_payments set pay_month = date_trunc('month', date_paid)::date where payout_type = 'Assistant' and pay_month is null;
with historical_payouts as (
  select distinct on (coach_id, pay_month) id, coach_id, pay_month
  from public.coach_payments
  where payout_type = 'Assistant'
  order by coach_id, pay_month, id
)
update public.coach_attendance ca
set coach_payment_id = hp.id
from historical_payouts hp
where ca.coach_id = hp.coach_id and ca.coach_payment_id is null
  and ca.attendance_date >= hp.pay_month and ca.attendance_date < (hp.pay_month + interval '1 month')::date;
create index if not exists coach_attendance_unsettled_idx on public.coach_attendance(coach_id, attendance_date) where coach_payment_id is null;
alter table public.coach_payments drop constraint if exists coach_payments_period_valid;
alter table public.coach_payments add constraint coach_payments_period_valid check (
  (payout_type = 'Assistant' and pay_month is not null and pay_month = date_trunc('month', pay_month)::date)
  or (payout_type = 'Head' and pay_month is null)
);

create or replace function public.prevent_duplicate_assistant_payout()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.payout_type = 'Assistant' and exists(
    select 1 from public.coach_payments cp
    where cp.coach_id = new.coach_id and cp.payout_type = 'Assistant' and cp.pay_month = new.pay_month and cp.id <> new.id
  ) then raise exception 'This assistant month is already settled'; end if;
  return new;
end;
$$;

create trigger coach_payments_prevent_duplicate_assistant before insert or update on public.coach_payments for each row execute function public.prevent_duplicate_assistant_payout();

create or replace function public.validate_payment_settlement()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_payout public.coach_payments%rowtype;
begin
  if new.commission_settled is distinct from (new.coach_payment_id is not null) then
    raise exception 'Payment settlement flag and payout link must agree';
  end if;
  if new.coach_payment_id is not null then
    select * into strict v_payout from public.coach_payments where id = new.coach_payment_id;
    if v_payout.payout_type <> 'Head' or v_payout.branch_id <> new.branch_id or v_payout.coach_id is distinct from new.coach_id then
      raise exception 'Payment and coach payout must have the same branch and head coach';
    end if;
  end if;
  return new;
end;
$$;

create or replace function public.prevent_settled_payment_delete()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if old.commission_settled or old.coach_payment_id is not null then
    raise exception 'Undo the linked coach payout before deleting this payment';
  end if;
  return old;
end;
$$;

create trigger payments_validate_settlement before insert or update on public.payments for each row execute function public.validate_payment_settlement();
create trigger payments_prevent_settled_delete before delete on public.payments for each row execute function public.prevent_settled_payment_delete();

create or replace function public.sync_coach_attendance_fields()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session_branch bigint;
  v_class bigint;
  v_date date;
  v_coach_branch bigint;
  v_start time;
  v_end time;
begin
  select branch_id, class_id, session_date into strict v_session_branch, v_class, v_date from public.sessions where id = new.session_id;
  select branch_id into strict v_coach_branch from public.coaches where id = new.coach_id;
  if v_session_branch is distinct from v_coach_branch then raise exception 'Coach and session must belong to the same branch'; end if;
  new.branch_id = v_session_branch;
  new.class_id = v_class;
  new.attendance_date = v_date;
  new.recorded_by = auth.uid();
  new.recorded_at = now();
  if tg_op = 'INSERT' or not public.is_admin() then
    select start_time, end_time into v_start, v_end from public.classes where id = v_class;
    new.hours = case when v_start is null or v_end is null then 0 else round((extract(epoch from (v_end - v_start)) / 3600)::numeric, 2) end;
  end if;
  return new;
end;
$$;

create or replace function public.assert_attendance_access(p_branch_id bigint, p_date date)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.can_access_branch(p_branch_id) then raise exception 'Branch access denied'; end if;
  if not public.is_admin() and p_date <> current_date then raise exception 'Basic attendance access is limited to today'; end if;
end;
$$;

create or replace function public.set_attendance_status(p_student_id bigint, p_session_id bigint, p_status text)
returns public.attendance
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session public.sessions%rowtype;
  v_result public.attendance%rowtype;
begin
  if p_status not in ('', 'Present') then raise exception 'Invalid attendance status'; end if;
  select * into strict v_session from public.sessions where id = p_session_id;
  perform public.assert_attendance_access(v_session.branch_id, v_session.session_date);
  insert into public.attendance (student_id, session_id, class_id, branch_id, attendance_date, status, remarks)
  values (p_student_id, p_session_id, v_session.class_id, v_session.branch_id, v_session.session_date, p_status, '')
  on conflict (student_id, session_id) do update set status = excluded.status
  returning * into v_result;
  return v_result;
end;
$$;

create or replace function public.set_attendance_remark(p_student_id bigint, p_session_id bigint, p_remarks text)
returns public.attendance
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session public.sessions%rowtype;
  v_result public.attendance%rowtype;
begin
  select * into strict v_session from public.sessions where id = p_session_id;
  perform public.assert_attendance_access(v_session.branch_id, v_session.session_date);
  insert into public.attendance (student_id, session_id, class_id, branch_id, attendance_date, status, remarks)
  values (p_student_id, p_session_id, v_session.class_id, v_session.branch_id, v_session.session_date, '', coalesce(p_remarks, ''))
  on conflict (student_id, session_id) do update set remarks = excluded.remarks
  returning * into v_result;
  return v_result;
end;
$$;

create or replace function public.mark_all_present(p_session_id bigint, p_student_ids bigint[])
returns setof public.attendance
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session public.sessions%rowtype;
begin
  select * into strict v_session from public.sessions where id = p_session_id;
  perform public.assert_attendance_access(v_session.branch_id, v_session.session_date);
  if exists(
    select 1 from unnest(coalesce(p_student_ids, '{}'::bigint[])) requested(student_id)
    left join public.students s on s.id = requested.student_id
    where s.id is null or s.branch_id <> v_session.branch_id or s.status = 'Inactive'
      or not exists(
        select 1 from public.enrollments e
        where e.student_id = requested.student_id and e.class_id = v_session.class_id
          and e.start_date <= v_session.session_date and (e.end_date is null or e.end_date >= v_session.session_date)
      )
  ) then raise exception 'All-present contains an ineligible student'; end if;
  insert into public.attendance (student_id, session_id, class_id, branch_id, attendance_date, status, remarks)
  select requested.student_id, v_session.id, v_session.class_id, v_session.branch_id, v_session.session_date, 'Present', ''
  from unnest(coalesce(p_student_ids, '{}'::bigint[])) requested(student_id)
  on conflict (student_id, session_id) do update set status = 'Present';
  return query select * from public.attendance where session_id = p_session_id;
end;
$$;

create or replace function public.record_coach_payout(
  p_coach_id bigint,
  p_amount numeric,
  p_units numeric,
  p_rate numeric,
  p_students_count integer,
  p_date_paid date,
  p_remarks text default '',
  p_pay_month date default null
)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_coach public.coaches%rowtype;
  v_payout_id bigint;
  v_payment_ids bigint[] := '{}'::bigint[];
  v_attendance_ids bigint[] := '{}'::bigint[];
  v_students_count integer := 0;
  v_units numeric := 0;
  v_rate numeric := 0;
  v_amount numeric := 0;
  v_pay_month date;
begin
  if not public.is_admin() then raise exception 'Admin access required'; end if;
  select * into strict v_coach from public.coaches where id = p_coach_id for update;
  if not public.can_access_branch(v_coach.branch_id) then raise exception 'Branch access denied'; end if;

  if v_coach.coach_type = 'Head' then
    select coalesce(array_agg(id), '{}'::bigint[]), count(distinct student_id)
    into v_payment_ids, v_students_count
    from (
      select p.id, p.student_id
      from public.payments p
      where p.branch_id = v_coach.branch_id and p.coach_id = v_coach.id and p.status = 'Paid' and not p.commission_settled
      for update
    ) locked_payments;
    v_units = cardinality(v_payment_ids);
    if v_units = 0 then raise exception 'No unsettled commission units remain'; end if;
    select coalesce(sum(coalesce((
      select r.payout from public.head_coach_rates r
      where v_students_count between r.min_students and r.max_students
        and s.monthly_fee between r.min_fee and r.max_fee
      order by r.min_students desc, r.min_fee desc limit 1
    ), 0)), 0)
    into v_amount
    from public.payments p join public.students s on s.id = p.student_id
    where p.id = any(v_payment_ids);
    if round(coalesce(p_amount, -1), 2) <> round(v_amount, 2) then raise exception 'Payout preview is stale; refresh and try again'; end if;
  else
    if p_pay_month is null then raise exception 'Assistant payout month is required'; end if;
    v_pay_month = date_trunc('month', p_pay_month)::date;
    if exists(select 1 from public.coach_payments where coach_id = v_coach.id and payout_type = 'Assistant' and pay_month = v_pay_month) then
      raise exception 'This assistant month is already settled';
    end if;
    select coalesce(array_agg(id), '{}'::bigint[]), coalesce(sum(hours), 0)
    into v_attendance_ids, v_units
    from (
      select ca.id, ca.hours
      from public.coach_attendance ca
      where ca.coach_id = v_coach.id and ca.coach_payment_id is null
        and ca.attendance_date >= v_pay_month and ca.attendance_date < (v_pay_month + interval '1 month')::date
      for update
    ) locked_attendance;
    if cardinality(v_attendance_ids) = 0 then raise exception 'No unsettled assistant attendance remains for this month'; end if;
    v_rate = v_coach.hourly_rate;
    v_amount = round(v_units * v_rate, 2);
    if round(coalesce(p_amount, -1), 2) <> v_amount then raise exception 'Payout preview is stale; refresh and try again'; end if;
  end if;

  if coalesce(p_units, -1) <> v_units or coalesce(p_students_count, -1) <> v_students_count
    or (v_coach.coach_type = 'Assistant' and coalesce(p_rate, -1) <> v_rate)
    or (v_coach.coach_type = 'Head' and coalesce(p_rate, 0) <> 0) then
    raise exception 'Payout preview is stale; refresh and try again';
  end if;

  insert into public.coach_payments (branch_id, coach_id, payout_type, pay_month, amount, units, rate, students_count, date_paid, remarks)
  values (v_coach.branch_id, v_coach.id, v_coach.coach_type::text::public.payout_type, v_pay_month, v_amount, v_units, v_rate, v_students_count, p_date_paid, coalesce(p_remarks, ''))
  returning id into v_payout_id;

  if v_coach.coach_type = 'Head' then
    with lines as (
      select p.id, p.student_id, s.monthly_fee,
        coalesce((select r.payout from public.head_coach_rates r
          where v_students_count between r.min_students and r.max_students
            and s.monthly_fee between r.min_fee and r.max_fee
          order by r.min_students desc, r.min_fee desc limit 1), 0) as line_payout
      from public.payments p join public.students s on s.id = p.student_id
      where p.id = any(v_payment_ids)
    )
    insert into public.coach_payment_lines (coach_payment_id, payment_id, student_id, student_fee, students_count, payout, matched)
    select v_payout_id, id, student_id, monthly_fee, v_students_count, line_payout, monthly_fee is not null and line_payout > 0 from lines;
    update public.payments set commission_settled = true, coach_payment_id = v_payout_id, updated_at = now() where id = any(v_payment_ids);
  else
    update public.coach_attendance set coach_payment_id = v_payout_id where id = any(v_attendance_ids);
  end if;
  return v_payout_id;
end;
$$;

create or replace function public.undo_coach_payout(p_coach_payment_id bigint)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_branch bigint;
begin
  if not public.is_admin() then raise exception 'Admin access required'; end if;
  select branch_id into strict v_branch from public.coach_payments where id = p_coach_payment_id for update;
  if not public.can_access_branch(v_branch) then raise exception 'Branch access denied'; end if;
  update public.payments set commission_settled = false, coach_payment_id = null, updated_at = now() where coach_payment_id = p_coach_payment_id;
  update public.coach_attendance set coach_payment_id = null where coach_payment_id = p_coach_payment_id;
  delete from public.coach_payments where id = p_coach_payment_id;
end;
$$;

create or replace function public.get_assistant_pay(p_coach_id bigint, p_branch_id bigint, p_month date)
returns jsonb
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  v_rate numeric;
  v_result jsonb;
begin
  if not public.is_admin() then raise exception 'Admin access required'; end if;
  if not public.can_access_branch(p_branch_id) then raise exception 'Branch access denied'; end if;
  select hourly_rate into strict v_rate from public.coaches where id = p_coach_id and branch_id = p_branch_id and coach_type = 'Assistant';
  with entries as (
    select ca.attendance_date, c.label as class_name, ca.hours
    from public.coach_attendance ca join public.classes c on c.id = ca.class_id
    where ca.coach_id = p_coach_id and ca.branch_id = p_branch_id and ca.coach_payment_id is null
      and ca.attendance_date >= date_trunc('month', p_month)::date
      and ca.attendance_date < (date_trunc('month', p_month) + interval '1 month')::date
  )
  select jsonb_build_object(
    'type', 'Assistant', 'month', to_char(p_month, 'YYYY-MM'), 'hours', coalesce(sum(hours), 0),
    'hourlyRate', v_rate, 'total', coalesce(sum(hours), 0) * v_rate,
    'sessions', coalesce(jsonb_agg(jsonb_build_object('date', attendance_date, 'className', class_name, 'hours', hours) order by attendance_date desc), '[]'::jsonb)
  ) into v_result from entries;
  return v_result;
end;
$$;

create policy attendance_admin_all on public.attendance for all to authenticated using (public.is_admin()) with check (public.is_admin());
drop policy if exists attendance_write on public.attendance;
create policy attendance_today_insert on public.attendance for insert to authenticated with check (public.can_access_branch(branch_id) and attendance_date = current_date);
create policy attendance_today_update on public.attendance for update to authenticated using (public.can_access_branch(branch_id) and attendance_date = current_date) with check (public.can_access_branch(branch_id) and attendance_date = current_date);
create policy attendance_today_delete on public.attendance for delete to authenticated using (public.can_access_branch(branch_id) and attendance_date = current_date);

drop policy if exists coach_attendance_write on public.coach_attendance;
create policy coach_attendance_admin_all on public.coach_attendance for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy coach_attendance_today_insert on public.coach_attendance for insert to authenticated with check (public.can_access_branch(branch_id) and attendance_date = current_date);
create policy coach_attendance_today_update on public.coach_attendance for update to authenticated using (public.can_access_branch(branch_id) and attendance_date = current_date) with check (public.can_access_branch(branch_id) and attendance_date = current_date);
create policy coach_attendance_today_delete on public.coach_attendance for delete to authenticated using (public.can_access_branch(branch_id) and attendance_date = current_date);

revoke all on function public.reconcile_student_enrollments(bigint, jsonb, jsonb) from public, anon;
revoke all on function public.save_student_with_enrollments(bigint, jsonb, jsonb, jsonb) from public, anon;
revoke all on function public.set_attendance_status(bigint, bigint, text) from public, anon;
revoke all on function public.set_attendance_remark(bigint, bigint, text) from public, anon;
revoke all on function public.mark_all_present(bigint, bigint[]) from public, anon;
revoke all on function public.assert_attendance_access(bigint, date) from public, anon;
revoke all on function public.get_assistant_pay(bigint, bigint, date) from public, anon;
grant execute on function public.reconcile_student_enrollments(bigint, jsonb, jsonb) to authenticated;
grant execute on function public.save_student_with_enrollments(bigint, jsonb, jsonb, jsonb) to authenticated;
grant execute on function public.set_attendance_status(bigint, bigint, text) to authenticated;
grant execute on function public.set_attendance_remark(bigint, bigint, text) to authenticated;
grant execute on function public.mark_all_present(bigint, bigint[]) to authenticated;
grant execute on function public.get_assistant_pay(bigint, bigint, date) to authenticated;
