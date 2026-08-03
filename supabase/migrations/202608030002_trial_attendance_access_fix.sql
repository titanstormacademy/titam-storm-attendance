create or replace function public.set_attendance_status(p_student_id bigint, p_session_id bigint, p_status text)
returns public.attendance
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session public.sessions%rowtype;
  v_student_status public.record_status;
  v_result public.attendance%rowtype;
begin
  if p_status not in ('', 'Present') then raise exception 'Invalid attendance status'; end if;
  select * into strict v_session from public.sessions where id = p_session_id;
  select status into strict v_student_status from public.students where id = p_student_id and branch_id = v_session.branch_id;
  if not public.is_admin() and (v_session.session_date <> current_date or not public.can_access_branch(v_session.branch_id)) then
    raise exception 'Attendance access is limited to administrators or assigned staff for today';
  end if;
  insert into public.attendance (student_id, session_id, class_id, branch_id, attendance_date, status, remarks, is_trial)
  values (p_student_id, p_session_id, v_session.class_id, v_session.branch_id, v_session.session_date, p_status, '', v_student_status = 'Trial')
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
  v_student_status public.record_status;
  v_result public.attendance%rowtype;
begin
  select * into strict v_session from public.sessions where id = p_session_id;
  select status into strict v_student_status from public.students where id = p_student_id and branch_id = v_session.branch_id;
  if not public.is_admin() and (v_session.session_date <> current_date or not public.can_access_branch(v_session.branch_id)) then
    raise exception 'Attendance access is limited to administrators or assigned staff for today';
  end if;
  insert into public.attendance (student_id, session_id, class_id, branch_id, attendance_date, status, remarks, is_trial)
  values (p_student_id, p_session_id, v_session.class_id, v_session.branch_id, v_session.session_date, '', coalesce(p_remarks, ''), v_student_status = 'Trial')
  on conflict (student_id, session_id) do update set remarks = excluded.remarks
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
  select requested.student_id, v_session.id, v_session.class_id, v_session.branch_id, v_session.session_date, 'Present', '', s.status = 'Trial'
  from unnest(coalesce(p_student_ids, '{}'::bigint[])) requested(student_id)
  join public.students s on s.id = requested.student_id
  on conflict (student_id, session_id) do update set status = 'Present';
  return query select * from public.attendance where session_id = p_session_id;
end;
$$;

revoke all on function public.set_attendance_status(bigint, bigint, text) from public, anon;
revoke all on function public.set_attendance_remark(bigint, bigint, text) from public, anon;
revoke all on function public.set_attendance_trial(bigint, bigint, boolean) from public, anon;
revoke all on function public.mark_all_present(bigint, bigint[]) from public, anon;
grant execute on function public.set_attendance_status(bigint, bigint, text) to authenticated;
grant execute on function public.set_attendance_remark(bigint, bigint, text) to authenticated;
grant execute on function public.set_attendance_trial(bigint, bigint, boolean) to authenticated;
grant execute on function public.mark_all_present(bigint, bigint[]) to authenticated;
