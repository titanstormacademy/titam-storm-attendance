create or replace function public.get_basic_bootstrap(p_branch_id bigint)
returns jsonb
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  v_result jsonb;
begin
  if auth.uid() is null or public.is_admin() or not public.can_access_branch(p_branch_id) then
    raise exception 'Basic branch access required';
  end if;

  select jsonb_build_object(
    'students', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', s.id,
        'branch_id', s.branch_id,
        'name', s.name,
        'nric', '',
        'gender', '',
        'date_of_birth', null,
        'age', null,
        'height', '',
        'school', '',
        'tshirt_size', '',
        'student_phone', '',
        'parent_name', '',
        'parent_contact', '',
        'email', '',
        'father_height', '',
        'mother_height', '',
        'monthly_fee', null,
        'level', s.level,
        'status', s.status,
        'photo_path', s.photo_path,
        'created_at', s.created_at
      ) order by s.name)
      from public.students s where s.branch_id = p_branch_id
    ), '[]'::jsonb),
    'coaches', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', c.id,
        'branch_id', c.branch_id,
        'name', c.name,
        'phone', '',
        'coach_type', c.coach_type,
        'hourly_rate', 0,
        'status', c.status,
        'photo_path', c.photo_path
      ) order by c.name)
      from public.coaches c where c.branch_id = p_branch_id
    ), '[]'::jsonb),
    'classes', coalesce((
      select jsonb_agg(to_jsonb(c) || jsonb_build_object(
        'coach', case when co.id is null then null else jsonb_build_object('id', co.id, 'name', co.name) end
      ) order by c.day_of_week, c.start_time)
      from public.classes c
      left join public.coaches co on co.id = c.coach_id
      where c.branch_id = p_branch_id
    ), '[]'::jsonb),
    'sessions', coalesce((
      select jsonb_agg(to_jsonb(s) || jsonb_build_object(
        'class', jsonb_build_object('id', cl.id, 'label', cl.label, 'start_time', cl.start_time, 'end_time', cl.end_time),
        'coach', case when co.id is null then null else jsonb_build_object('id', co.id, 'name', co.name) end
      ) order by s.session_date)
      from public.sessions s
      join public.classes cl on cl.id = s.class_id
      left join public.coaches co on co.id = s.coach_id
      where s.branch_id = p_branch_id and s.session_date = current_date
    ), '[]'::jsonb),
    'enrollments', coalesce((
      select jsonb_agg(to_jsonb(e)) from public.enrollments e
      where e.branch_id = p_branch_id and e.start_date <= current_date and (e.end_date is null or e.end_date >= current_date)
    ), '[]'::jsonb),
    'payments', '[]'::jsonb
  ) into v_result;

  return v_result;
end;
$$;

drop policy if exists sessions_read on public.sessions;
drop policy if exists sessions_today_read on public.sessions;
create policy sessions_today_read on public.sessions for select to authenticated using (public.is_admin() or (public.can_access_branch(branch_id) and session_date = current_date));

drop policy if exists attendance_read on public.attendance;
drop policy if exists attendance_today_read on public.attendance;
create policy attendance_today_read on public.attendance for select to authenticated using (public.is_admin() or (public.can_access_branch(branch_id) and attendance_date = current_date));

drop policy if exists coach_attendance_read on public.coach_attendance;
drop policy if exists coach_attendance_today_read on public.coach_attendance;
create policy coach_attendance_today_read on public.coach_attendance for select to authenticated using (public.is_admin() or (public.can_access_branch(branch_id) and attendance_date = current_date));

revoke all on function public.get_basic_bootstrap(bigint) from public, anon;
grant execute on function public.get_basic_bootstrap(bigint) to authenticated;
