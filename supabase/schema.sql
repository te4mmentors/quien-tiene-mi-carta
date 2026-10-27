-- ¿Quién tiene mi carta? · Esquema de base de datos para Supabase
-- Pégalo completo en Supabase > SQL Editor > New query y pulsa "Run".
-- Se puede volver a ejecutar sin perder datos.

-- =====================================================================
-- Préstamos: cada fila es una carta (o varias copias) prestada o recibida
-- =====================================================================
create table if not exists public.loans (
  id                  uuid primary key default gen_random_uuid(),
  owner_id            uuid not null default auth.uid() references auth.users(id) on delete cascade,
  dir                 text not null default 'out' check (dir in ('out','in')),   -- out = yo presté, in = me prestaron
  card                text not null check (char_length(card) between 1 and 200),
  set_code            text not null default '' check (char_length(set_code) <= 10),
  person              text not null check (char_length(person) between 1 and 100),
  phone               text not null default '' check (char_length(phone) <= 30),
  qty                 integer not null default 1 check (qty between 1 and 999),
  value               bigint not null default 0 check (value >= 0),              -- valor por copia en COP
  foil                boolean not null default false,
  due                 date,
  note                text not null default '' check (char_length(note) <= 500),
  confirmed_at        timestamptz,   -- out: el otro confirmó que la tiene · in: yo avisé que la recibí
  returned_at         timestamptz,
  return_confirmed_at timestamptz,   -- in: el dueño confirmó que la recibió de vuelta
  example             boolean not null default false,
  created_at          timestamptz not null default now()
);
create index if not exists loans_owner_idx on public.loans (owner_id, created_at);

alter table public.loans enable row level security;

drop policy if exists "loans_select_own" on public.loans;
drop policy if exists "loans_insert_own" on public.loans;
drop policy if exists "loans_update_own" on public.loans;
drop policy if exists "loans_delete_own" on public.loans;
create policy "loans_select_own" on public.loans for select to authenticated using (owner_id = (select auth.uid()));
create policy "loans_insert_own" on public.loans for insert to authenticated with check (owner_id = (select auth.uid()));
create policy "loans_update_own" on public.loans for update to authenticated using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
create policy "loans_delete_own" on public.loans for delete to authenticated using (owner_id = (select auth.uid()));

revoke all on public.loans from anon;
grant select, insert, update, delete on public.loans to authenticated;

-- =====================================================================
-- Confirmaciones: el link que se envía por WhatsApp (no requiere cuenta)
-- =====================================================================
create table if not exists public.confirmations (
  token        text primary key default replace(gen_random_uuid()::text, '-', ''),
  owner_id     uuid not null references auth.users(id) on delete cascade,
  kind         text not null check (kind in ('loan','return')),  -- loan = "confirma que las tienes" · return = "confirma que las recibiste"
  loan_ids     uuid[] not null,
  sender_name  text not null default '',
  created_at   timestamptz not null default now(),
  responded_at timestamptz
);
create index if not exists confirmations_owner_idx on public.confirmations (owner_id);

alter table public.confirmations enable row level security;
drop policy if exists "confirmations_select_own" on public.confirmations;
create policy "confirmations_select_own" on public.confirmations for select to authenticated using (owner_id = (select auth.uid()));
revoke all on public.confirmations from anon, authenticated;
grant select on public.confirmations to authenticated;

-- Crea (o reutiliza) el link de confirmación para un grupo de préstamos propios
create or replace function public.create_confirmation(p_loan_ids uuid[], p_kind text, p_sender text default '')
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid   uuid := auth.uid();
  v_ids   uuid[];
  v_want  int;
  v_token text;
begin
  if v_uid is null then
    raise exception 'Debes iniciar sesión' using errcode = '42501';
  end if;
  if p_kind not in ('loan','return') then
    raise exception 'Tipo de confirmación inválido' using errcode = '22023';
  end if;

  select count(distinct x) into v_want from unnest(p_loan_ids) as x;
  select array_agg(id order by id) into v_ids
    from loans where id = any(p_loan_ids) and owner_id = v_uid;

  if v_want = 0 or v_ids is null or cardinality(v_ids) <> v_want then
    raise exception 'Préstamos inválidos' using errcode = '22023';
  end if;

  select token into v_token
    from confirmations
   where owner_id = v_uid and kind = p_kind and responded_at is null and loan_ids = v_ids
   limit 1;

  if v_token is null then
    insert into confirmations (owner_id, kind, loan_ids, sender_name)
    values (v_uid, p_kind, v_ids, left(coalesce(p_sender, ''), 80))
    returning token into v_token;
  end if;
  return v_token;
end;
$$;

-- Lo que ve quien abre el link (sin cuenta): solo lo necesario, nunca teléfonos ni notas
create or replace function public.get_confirmation(p_token text)
returns json
language sql
stable
security definer
set search_path = public
as $$
  select json_build_object(
    'kind',         c.kind,
    'sender',       c.sender_name,
    'created_at',   c.created_at,
    'responded_at', c.responded_at,
    'person',       (select l.person from loans l where l.id = any(c.loan_ids) limit 1),
    'items',        coalesce((
                      select json_agg(json_build_object(
                               'card', l.card, 'set', l.set_code, 'qty', l.qty,
                               'foil', l.foil, 'value', l.value, 'due', l.due)
                             order by l.card)
                        from loans l where l.id = any(c.loan_ids)), '[]'::json)
  )
  from confirmations c
  where c.token = p_token;
$$;

-- El botón "Sí, las tengo" / "Sí, las recibí"
create or replace function public.respond_confirmation(p_token text)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  c confirmations%rowtype;
begin
  update confirmations set responded_at = coalesce(responded_at, now())
   where token = p_token
   returning * into c;
  if not found then
    return null;
  end if;

  if c.kind = 'loan' then
    update loans set confirmed_at = coalesce(confirmed_at, now())
     where id = any(c.loan_ids) and owner_id = c.owner_id;
  else
    update loans set return_confirmed_at = coalesce(return_confirmed_at, now())
     where id = any(c.loan_ids) and owner_id = c.owner_id;
  end if;

  return public.get_confirmation(p_token);
end;
$$;

revoke all on function public.create_confirmation(uuid[], text, text) from public, anon;
revoke all on function public.get_confirmation(text) from public;
revoke all on function public.respond_confirmation(text) from public;
grant execute on function public.create_confirmation(uuid[], text, text) to authenticated;
grant execute on function public.get_confirmation(text) to anon, authenticated;
grant execute on function public.respond_confirmation(text) to anon, authenticated;
