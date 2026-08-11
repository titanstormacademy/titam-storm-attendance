create or replace function public.sync_attendance_fields()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_student_branch bigint;
  v_session_branch bigint;
  v_class_id bigint;
  v_date date;
begin
  select branch_id into strict v_student_branch from public.students where id = new.student_id;
  select branch_id, class_id, session_date into strict v_session_branch, v_class_id, v_date from public.sessions where id = new.session_id;
  if v_student_branch is distinct from v_session_branch then raise exception 'Student and session must belong to the same branch'; end if;
  if coalesce(new.is_trial, false) and exists(
    select 1 from public.enrollments e
    where e.student_id = new.student_id and e.class_id = v_class_id
      and e.start_date <= v_date and (e.end_date is null or e.end_date >= v_date)
  ) then raise exception 'Only walk-in attendance can be marked as trial'; end if;
  new.branch_id = v_session_branch;
  new.class_id = v_class_id;
  new.attendance_date = v_date;
  new.recorded_by = auth.uid();
  new.recorded_at = now();
  return new;
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
  v_student_status public.record_status;
  v_walkin boolean;
  v_result public.attendance%rowtype;
begin
  if p_status not in ('', 'Present') then raise exception 'Invalid attendance status'; end if;
  select * into strict v_session from public.sessions where id = p_session_id;
  select status into strict v_student_status from public.students where id = p_student_id and branch_id = v_session.branch_id;
  if not public.is_admin() and (v_session.session_date <> current_date or not public.can_access_branch(v_session.branch_id)) then
    raise exception 'Attendance access is limited to administrators or assigned staff for today';
  end if;
  v_walkin = not exists(
    select 1 from public.enrollments e
    where e.student_id = p_student_id and e.class_id = v_session.class_id
      and e.start_date <= v_session.session_date and (e.end_date is null or e.end_date >= v_session.session_date)
  );
  insert into public.attendance (student_id, session_id, class_id, branch_id, attendance_date, status, remarks, is_trial)
  values (p_student_id, p_session_id, v_session.class_id, v_session.branch_id, v_session.session_date, p_status, '', v_walkin and v_student_status = 'Trial')
  on conflict (student_id, session_id) do update set
    status = excluded.status,
    is_trial = case when v_walkin then attendance.is_trial else false end
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
  v_student_status public.record_status;
  v_walkin boolean;
  v_result public.attendance%rowtype;
begin
  select * into strict v_session from public.sessions where id = p_session_id;
  select status into strict v_student_status from public.students where id = p_student_id and branch_id = v_session.branch_id;
  if not public.is_admin() and (v_session.session_date <> current_date or not public.can_access_branch(v_session.branch_id)) then
    raise exception 'Attendance access is limited to administrators or assigned staff for today';
  end if;
  v_walkin = not exists(
    select 1 from public.enrollments e
    where e.student_id = p_student_id and e.class_id = v_session.class_id
      and e.start_date <= v_session.session_date and (e.end_date is null or e.end_date >= v_session.session_date)
  );
  insert into public.attendance (student_id, session_id, class_id, branch_id, attendance_date, status, remarks, is_trial)
  values (p_student_id, p_session_id, v_session.class_id, v_session.branch_id, v_session.session_date, '', coalesce(p_remarks, ''), v_walkin and v_student_status = 'Trial')
  on conflict (student_id, session_id) do update set
    remarks = excluded.remarks,
    is_trial = case when v_walkin then attendance.is_trial else false end
  returning * into v_result;
  return v_result;
end;
$$;

create or replace function public.set_attendance_trial(p_student_id bigint, p_session_id bigint, p_is_trial boolean)
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
  if not public.is_admin() and (v_session.session_date <> current_date or not public.can_access_branch(v_session.branch_id)) then
    raise exception 'Attendance access is limited to administrators or assigned staff for today';
  end if;
  if coalesce(p_is_trial, false) and exists(
    select 1 from public.enrollments e
    where e.student_id = p_student_id and e.class_id = v_session.class_id
      and e.start_date <= v_session.session_date and (e.end_date is null or e.end_date >= v_session.session_date)
  ) then raise exception 'Only walk-in attendance can be marked as trial'; end if;
  update public.attendance
  set is_trial = coalesce(p_is_trial, false)
  where student_id = p_student_id and session_id = p_session_id
  returning * into v_result;
  if not found then raise exception 'Mark the student present before setting trial attendance'; end if;
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
  if not public.is_admin() and (v_session.session_date <> current_date or not public.can_access_branch(v_session.branch_id)) then
    raise exception 'Attendance access is limited to administrators or assigned staff for today';
  end if;
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
  insert into public.attendance (student_id, session_id, class_id, branch_id, attendance_date, status, remarks, is_trial)
  select requested.student_id, v_session.id, v_session.class_id, v_session.branch_id, v_session.session_date, 'Present', '', false
  from unnest(coalesce(p_student_ids, '{}'::bigint[])) requested(student_id)
  join public.students s on s.id = requested.student_id
  on conflict (student_id, session_id) do update set status = 'Present', is_trial = false;
  return query select * from public.attendance where session_id = p_session_id;
end;
$$;

update public.attendance a
set is_trial = false
where a.is_trial and exists(
  select 1 from public.enrollments e
  where e.student_id = a.student_id and e.class_id = a.class_id
    and e.start_date <= a.attendance_date and (e.end_date is null or e.end_date >= a.attendance_date)
);

revoke all on function public.set_attendance_status(bigint, bigint, text) from public, anon;
revoke all on function public.set_attendance_remark(bigint, bigint, text) from public, anon;
revoke all on function public.set_attendance_trial(bigint, bigint, boolean) from public, anon;
revoke all on function public.mark_all_present(bigint, bigint[]) from public, anon;
grant execute on function public.set_attendance_status(bigint, bigint, text) to authenticated;
grant execute on function public.set_attendance_remark(bigint, bigint, text) to authenticated;
grant execute on function public.set_attendance_trial(bigint, bigint, boolean) to authenticated;
grant execute on function public.mark_all_present(bigint, bigint[]) to authenticated;
