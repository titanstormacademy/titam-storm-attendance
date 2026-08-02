alter table public.students add column if not exists age smallint;
alter table public.students drop constraint if exists students_age_valid;
alter table public.students add constraint students_age_valid check (age is null or age between 0 and 120);
alter table public.students drop constraint if exists students_age_source;
alter table public.students add constraint students_age_source check (date_of_birth is null or age is null);

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
  v_date_of_birth date := nullif(p_student ->> 'date_of_birth', '')::date;
  v_age smallint := nullif(p_student ->> 'age', '')::smallint;
begin
  if not public.is_admin() then raise exception 'Admin access required'; end if;
  if not public.can_access_branch(p_branch_id) then raise exception 'Branch access denied'; end if;
  if btrim(coalesce(p_student ->> 'name', '')) = '' then raise exception 'Student name is required'; end if;
  if v_date_of_birth is not null then v_age = null; end if;
  if v_age is not null and (v_age < 0 or v_age > 120) then raise exception 'Age must be between 0 and 120'; end if;
  if v_date_of_birth > current_date then raise exception 'Date of birth cannot be in the future'; end if;
  if v_id is null then
    insert into public.students (
      branch_id, name, nric, gender, date_of_birth, age, height, school, tshirt_size, student_phone,
      parent_name, parent_contact, email, father_height, mother_height, monthly_fee, level, status, photo_path
    ) values (
      p_branch_id, btrim(p_student ->> 'name'), coalesce(p_student ->> 'nric', ''), coalesce(p_student ->> 'gender', ''), v_date_of_birth, v_age,
      coalesce(p_student ->> 'height', ''), coalesce(p_student ->> 'school', ''), coalesce(p_student ->> 'tshirt_size', ''), coalesce(p_student ->> 'student_phone', ''),
      coalesce(p_student ->> 'parent_name', ''), coalesce(p_student ->> 'parent_contact', ''), coalesce(p_student ->> 'email', ''), coalesce(p_student ->> 'father_height', ''),
      coalesce(p_student ->> 'mother_height', ''), nullif(p_student ->> 'monthly_fee', '')::numeric, coalesce(p_student ->> 'level', ''),
      coalesce(nullif(p_student ->> 'status', '')::public.record_status, 'Active'::public.record_status), nullif(p_student ->> 'photo_path', '')
    ) returning * into v_student;
  else
    update public.students set
      name = btrim(p_student ->> 'name'), nric = coalesce(p_student ->> 'nric', ''), gender = coalesce(p_student ->> 'gender', ''),
      date_of_birth = v_date_of_birth, age = v_age, height = coalesce(p_student ->> 'height', ''), school = coalesce(p_student ->> 'school', ''),
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

revoke all on function public.save_student_with_enrollments(bigint, jsonb, jsonb, jsonb) from public, anon;
grant execute on function public.save_student_with_enrollments(bigint, jsonb, jsonb, jsonb) to authenticated;
