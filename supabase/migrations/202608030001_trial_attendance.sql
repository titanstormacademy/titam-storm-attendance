alter table public.attendance add column if not exists is_trial boolean not null default false;

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
  perform public.assert_attendance_access(v_session.branch_id, v_session.session_date);
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
  perform public.assert_attendance_access(v_session.branch_id, v_session.session_date);
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
  perform public.assert_attendance_access(v_session.branch_id, v_session.session_date);
  update public.attendance
  set is_trial = coalesce(p_is_trial, false)
  where student_id = p_student_id and session_id = p_session_id
  returning * into v_result;
  if not found then raise exception 'Mark the student present before setting trial attendance'; end if;
  return v_result;
end;
$$;

revoke all on function public.set_attendance_status(bigint, bigint, text) from public, anon;
revoke all on function public.set_attendance_remark(bigint, bigint, text) from public, anon;
revoke all on function public.set_attendance_trial(bigint, bigint, boolean) from public, anon;
grant execute on function public.set_attendance_status(bigint, bigint, text) to authenticated;
grant execute on function public.set_attendance_remark(bigint, bigint, text) to authenticated;
grant execute on function public.set_attendance_trial(bigint, bigint, boolean) to authenticated;
