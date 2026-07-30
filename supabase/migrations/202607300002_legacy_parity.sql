drop index if exists public.payments_reference_unique_idx;
create index if not exists payments_reference_lookup_idx
  on public.payments(branch_id, lower(btrim(reference_no)))
  where btrim(reference_no) <> '';

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
  v_ids bigint[] := '{}';
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
      v_branch,
      p_student_id,
      v_month,
      case when v_month = v_primary then p_amount else 0 end,
      p_method,
      p_status,
      p_date_received,
      case
        when v_month = v_primary then coalesce(p_remarks, '')
        when btrim(coalesce(p_remarks, '')) = '' then 'Paid in ' || to_char(v_primary, 'FMMonth YYYY')
        else p_remarks || ' · Paid in ' || to_char(v_primary, 'FMMonth YYYY')
      end,
      case when v_month = v_primary then btrim(coalesce(p_reference_no, '')) else '' end,
      p_coach_id,
      p_receipt_path
    ) returning id into v_id;
    v_ids = array_append(v_ids, v_id);
  end loop;
  return v_ids;
end;
$$;

grant execute on function public.record_student_payment(bigint, date[], numeric, public.payment_method, public.payment_status, date, text, text, bigint, text) to authenticated;

alter function public.get_head_coach_commission(bigint, bigint) security invoker;

create or replace function public.sync_coach_attendance_fields()
returns trigger
language plpgsql
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
  if tg_op = 'INSERT' or not public.is_admin() then
    select start_time, end_time into v_start, v_end from public.classes where id = v_class;
    new.hours = case when v_start is null or v_end is null then 0 else round((extract(epoch from (v_end - v_start)) / 3600)::numeric, 2) end;
  end if;
  return new;
end;
$$;

create or replace function public.update_profile_access(p_user_id uuid, p_role public.app_role, p_branch_ids bigint[])
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_existing_role public.app_role;
begin
  if not public.is_admin() then raise exception 'Admin access required'; end if;
  select role into strict v_existing_role from public.profiles where id = p_user_id for update;
  if v_existing_role = 'admin' and p_role <> 'admin'
    and (select count(*) from public.profiles where role = 'admin') <= 1 then
    raise exception 'Cannot demote the only administrator';
  end if;
  if exists(select 1 from unnest(coalesce(p_branch_ids, '{}'::bigint[])) as requested(branch_id) left join public.branches b on b.id = requested.branch_id where b.id is null) then
    raise exception 'One or more branches do not exist';
  end if;
  update public.profiles set role = p_role where id = p_user_id;
  delete from public.branch_memberships where user_id = p_user_id;
  if p_role = 'staff' then
    insert into public.branch_memberships (user_id, branch_id)
    select p_user_id, requested.branch_id from unnest(coalesce(p_branch_ids, '{}'::bigint[])) as requested(branch_id);
  end if;
end;
$$;

create or replace function public.reconcile_student_enrollments(p_student_id bigint, p_enrollments jsonb)
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
  if exists(
    select 1 from jsonb_to_recordset(coalesce(p_enrollments, '[]'::jsonb)) as rows(class_id bigint, start_date date)
    left join public.classes c on c.id = rows.class_id
    where c.id is null or c.branch_id <> v_branch
  ) then raise exception 'Every class must belong to the student branch'; end if;
  delete from public.enrollments e
  where e.student_id = p_student_id
    and not exists(select 1 from jsonb_to_recordset(coalesce(p_enrollments, '[]'::jsonb)) as rows(class_id bigint, start_date date) where rows.class_id = e.class_id);
  insert into public.enrollments (student_id, class_id, start_date, branch_id)
  select p_student_id, rows.class_id, rows.start_date, v_branch
  from jsonb_to_recordset(coalesce(p_enrollments, '[]'::jsonb)) as rows(class_id bigint, start_date date)
  on conflict (student_id, class_id) do update set start_date = excluded.start_date;
end;
$$;

grant execute on function public.update_profile_access(uuid, public.app_role, bigint[]) to authenticated;
grant execute on function public.reconcile_student_enrollments(bigint, jsonb) to authenticated;

create or replace function public.protect_settled_payment_fields()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if old.commission_settled and (
    new.student_id is distinct from old.student_id or
    new.fee_month is distinct from old.fee_month or
    new.status is distinct from old.status or
    new.coach_id is distinct from old.coach_id
  ) then raise exception 'Undo the linked coach payout before changing commission fields'; end if;
  return new;
end;
$$;

drop trigger if exists payments_protect_settled on public.payments;
create trigger payments_protect_settled
before update on public.payments
for each row execute function public.protect_settled_payment_fields();
