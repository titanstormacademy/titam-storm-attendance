create extension if not exists pgcrypto with schema extensions;

create table if not exists public.shared_admin_config (
  singleton boolean primary key default true check (singleton),
  password_hash text,
  updated_at timestamptz not null default now()
);

insert into public.shared_admin_config (singleton) values (true)
on conflict (singleton) do nothing;

alter table public.shared_admin_config enable row level security;

alter table public.profiles
  add column if not exists login_kind text not null default 'account'
  check (login_kind in ('account', 'basic', 'shared_admin'));

create table if not exists public.admin_login_attempts (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  fail_count integer not null default 0,
  last_attempt_at timestamptz not null default now(),
  locked_until timestamptz
);

alter table public.admin_login_attempts enable row level security;

create or replace function public.is_anonymous_user()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false);
$$;

create or replace function public.login_as_basic(p_name text)
returns public.profiles
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name text := btrim(coalesce(p_name, ''));
  v_profile public.profiles%rowtype;
begin
  if auth.uid() is null or not public.is_anonymous_user() then
    raise exception 'Anonymous session required';
  end if;
  if length(v_name) < 2 or length(v_name) > 80 then
    raise exception 'Enter a name between 2 and 80 characters';
  end if;

  update public.profiles
  set full_name = v_name, role = 'staff', login_kind = 'basic', updated_at = now()
  where id = auth.uid()
  returning * into strict v_profile;

  delete from public.branch_memberships where user_id = auth.uid();
  insert into public.branch_memberships (user_id, branch_id)
  select auth.uid(), id from public.branches where status = 'Active'
  on conflict do nothing;

  return v_profile;
end;
$$;

create or replace function public.login_with_shared_admin_password(p_name text, p_password text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_name text := btrim(coalesce(p_name, ''));
  v_hash text;
  v_attempt public.admin_login_attempts%rowtype;
  v_fail_count integer;
  v_profile public.profiles%rowtype;
begin
  if auth.uid() is null or not public.is_anonymous_user() then
    raise exception 'Anonymous session required';
  end if;
  if length(v_name) < 2 or length(v_name) > 80 then
    raise exception 'Enter a name between 2 and 80 characters';
  end if;

  select * into v_attempt from public.admin_login_attempts where user_id = auth.uid() for update;
  if v_attempt.locked_until is not null and v_attempt.locked_until > now() then
    return jsonb_build_object('ok', false, 'error', 'Too many incorrect attempts. Try again later.');
  end if;

  select password_hash into v_hash from public.shared_admin_config where singleton;
  if v_hash is null or v_hash = '' then
    return jsonb_build_object('ok', false, 'error', 'Shared admin password is not configured. Use emergency account login.');
  end if;

  if extensions.crypt(coalesce(p_password, ''), v_hash) <> v_hash then
    v_fail_count := coalesce(v_attempt.fail_count, 0) + 1;
    insert into public.admin_login_attempts (user_id, fail_count, last_attempt_at, locked_until)
    values (auth.uid(), v_fail_count, now(), case when v_fail_count >= 5 then now() + interval '15 minutes' else null end)
    on conflict (user_id) do update set
      fail_count = excluded.fail_count,
      last_attempt_at = excluded.last_attempt_at,
      locked_until = excluded.locked_until;
    return jsonb_build_object('ok', false, 'error', 'Incorrect admin password');
  end if;

  delete from public.admin_login_attempts where user_id = auth.uid();
  update public.profiles
  set full_name = v_name, role = 'admin', login_kind = 'shared_admin', updated_at = now()
  where id = auth.uid()
  returning * into strict v_profile;

  delete from public.branch_memberships where user_id = auth.uid();
  return jsonb_build_object('ok', true, 'profile', to_jsonb(v_profile));
end;
$$;

create or replace function public.set_shared_admin_password(p_password text)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  if not public.is_admin() then
    raise exception 'Administrator access required';
  end if;
  if length(coalesce(p_password, '')) < 8 then
    raise exception 'Admin password must contain at least 8 characters';
  end if;
  update public.shared_admin_config
  set password_hash = extensions.crypt(p_password, extensions.gen_salt('bf', 12)), updated_at = now()
  where singleton;
end;
$$;

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
      where s.branch_id = p_branch_id
        and s.session_date >= current_date - interval '12 months'
        and s.session_date <= current_date + interval '12 months'
    ), '[]'::jsonb),
    'enrollments', coalesce((
      select jsonb_agg(to_jsonb(e)) from public.enrollments e where e.branch_id = p_branch_id
    ), '[]'::jsonb),
    'payments', '[]'::jsonb
  ) into v_result;

  return v_result;
end;
$$;

drop policy if exists students_read on public.students;
drop policy if exists students_staff_trial_insert on public.students;
drop policy if exists coaches_read on public.coaches;

alter function public.sync_session_branch() security definer;
alter function public.sync_attendance_fields() security definer;
alter function public.sync_coach_attendance_fields() security definer;

revoke all on function public.login_as_basic(text) from public;
revoke all on function public.login_with_shared_admin_password(text, text) from public;
revoke all on function public.set_shared_admin_password(text) from public;
revoke all on function public.get_basic_bootstrap(bigint) from public;

grant execute on function public.login_as_basic(text) to authenticated;
grant execute on function public.login_with_shared_admin_password(text, text) to authenticated;
grant execute on function public.set_shared_admin_password(text) to authenticated;
grant execute on function public.get_basic_bootstrap(bigint) to authenticated;
