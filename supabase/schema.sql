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


-- =====================================================================
-- Incluye la actualización 002 (guardar en mi cuenta desde el link)
-- =====================================================================

-- Cada préstamo agregado desde un link recuerda de qué préstamo viene (para no duplicarlo y para sincronizar la devolución)
alter table public.loans add column if not exists source_loan_id uuid;
create unique index if not exists loans_owner_source_uidx on public.loans (owner_id, source_loan_id) where source_loan_id is not null;

-- Lo que ve quien abre el link. Ahora también dice si el link es tuyo y si ya lo guardaste.
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
    'mine',         coalesce(c.owner_id = auth.uid(), false),
    'claimed',      exists (select 1 from loans m where m.owner_id = auth.uid() and m.source_loan_id = any(c.loan_ids)),
    'linked',       exists (select 1 from loans m where m.owner_id = auth.uid()
                              and m.id in (select l.source_loan_id from loans l where l.id = any(c.loan_ids))),
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

-- Confirmar. Si quien confirma una devolución tiene el préstamo original en su cuenta, se marca como devuelto.
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
    if auth.uid() is not null then
      update loans set returned_at = coalesce(returned_at, now())
       where owner_id = auth.uid()
         and id in (select l.source_loan_id from loans l where l.id = any(c.loan_ids) and l.source_loan_id is not null);
    end if;
  end if;

  return public.get_confirmation(p_token);
end;
$$;

-- "Sí, la tengo" con sesión iniciada: confirma y agrega las cartas a "Me prestaron" de quien confirma
create or replace function public.claim_confirmation(p_token text)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  c     confirmations%rowtype;
  v_n   int;
begin
  if v_uid is null then
    raise exception 'Debes iniciar sesión' using errcode = '42501';
  end if;
  select * into c from confirmations where token = p_token;
  if not found then
    return null;
  end if;
  if c.kind <> 'loan' then
    raise exception 'Este link no es de un préstamo' using errcode = '22023';
  end if;
  if c.owner_id = v_uid then
    raise exception 'Este préstamo es tuyo' using errcode = '22023';
  end if;

  perform public.respond_confirmation(p_token);

  insert into loans (owner_id, dir, card, set_code, person, qty, value, foil, due, confirmed_at, created_at, source_loan_id)
  select v_uid, 'in', l.card, l.set_code, left(coalesce(nullif(c.sender_name, ''), 'Alguien'), 100),
         l.qty, l.value, l.foil, l.due, now(), l.created_at, l.id
    from loans l
   where l.id = any(c.loan_ids) and l.owner_id = c.owner_id and l.returned_at is null
  on conflict (owner_id, source_loan_id) where source_loan_id is not null do nothing;
  get diagnostics v_n = row_count;

  return json_build_object('added', v_n, 'confirmation', public.get_confirmation(p_token));
end;
$$;

revoke all on function public.claim_confirmation(text) from public, anon;
grant execute on function public.claim_confirmation(text) to authenticated;
grant execute on function public.get_confirmation(text) to anon, authenticated;
grant execute on function public.respond_confirmation(text) to anon, authenticated;


-- =====================================================================
-- Incluye la actualización 003 (devolución confirmada = devuelta)
-- =====================================================================

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
    -- Quien devolvió: queda devuelta y confirmada
    update loans set return_confirmed_at = coalesce(return_confirmed_at, now()),
                     returned_at         = coalesce(returned_at, now())
     where id = any(c.loan_ids) and owner_id = c.owner_id;
    -- El dueño (si confirmó con su sesión y tiene el préstamo original): queda devuelta
    if auth.uid() is not null then
      update loans set returned_at = coalesce(returned_at, now())
       where owner_id = auth.uid()
         and id in (select l.source_loan_id from loans l where l.id = any(c.loan_ids) and l.source_loan_id is not null);
    end if;
  end if;

  return public.get_confirmation(p_token);
end;
$$;

grant execute on function public.respond_confirmation(text) to anon, authenticated;

-- Corrige las devoluciones que ya se habían confirmado antes de esta actualización
update public.loans l
   set returned_at = coalesce(l.returned_at, c.responded_at),
       return_confirmed_at = coalesce(l.return_confirmed_at, c.responded_at)
  from public.confirmations c
 where c.kind = 'return' and c.responded_at is not null
   and l.id = any(c.loan_ids) and l.owner_id = c.owner_id
   and l.returned_at is null;


-- =====================================================================
-- Incluye la actualización 004 (imagen de Scryfall y fotos)
-- =====================================================================

alter table public.loans add column if not exists scryfall_id text not null default '';
alter table public.loans add column if not exists image_url  text not null default '';
alter table public.loans add column if not exists photo_path text not null default '';
alter table public.loans drop constraint if exists loans_image_url_len;
alter table public.loans add constraint loans_image_url_len check (char_length(image_url) <= 500 and char_length(photo_path) <= 200 and char_length(scryfall_id) <= 64);

-- Espacio para las fotos: público para ver (nombres imposibles de adivinar), cada usuario solo sube y borra en su carpeta
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('card-photos', 'card-photos', true, 5242880, array['image/jpeg','image/png','image/webp'])
on conflict (id) do update
  set public = excluded.public, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "card_photos_insert_own" on storage.objects;
drop policy if exists "card_photos_update_own" on storage.objects;
drop policy if exists "card_photos_delete_own" on storage.objects;
create policy "card_photos_insert_own" on storage.objects for insert to authenticated
  with check (bucket_id = 'card-photos' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "card_photos_update_own" on storage.objects for update to authenticated
  using (bucket_id = 'card-photos' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "card_photos_delete_own" on storage.objects for delete to authenticated
  using (bucket_id = 'card-photos' and (storage.foldername(name))[1] = (select auth.uid())::text);

-- El link de confirmación ahora muestra la imagen de la carta y la foto
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
    'mine',         coalesce(c.owner_id = auth.uid(), false),
    'claimed',      exists (select 1 from loans m where m.owner_id = auth.uid() and m.source_loan_id = any(c.loan_ids)),
    'linked',       exists (select 1 from loans m where m.owner_id = auth.uid()
                              and m.id in (select l.source_loan_id from loans l where l.id = any(c.loan_ids))),
    'items',        coalesce((
                      select json_agg(json_build_object(
                               'card', l.card, 'set', l.set_code, 'qty', l.qty,
                               'foil', l.foil, 'value', l.value, 'due', l.due,
                               'image', l.image_url, 'photo', l.photo_path)
                             order by l.card)
                        from loans l where l.id = any(c.loan_ids)), '[]'::json)
  )
  from confirmations c
  where c.token = p_token;
$$;

-- Al guardar en mi cuenta desde el link, también se copian la imagen y la foto
create or replace function public.claim_confirmation(p_token text)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  c     confirmations%rowtype;
  v_n   int;
begin
  if v_uid is null then
    raise exception 'Debes iniciar sesión' using errcode = '42501';
  end if;
  select * into c from confirmations where token = p_token;
  if not found then
    return null;
  end if;
  if c.kind <> 'loan' then
    raise exception 'Este link no es de un préstamo' using errcode = '22023';
  end if;
  if c.owner_id = v_uid then
    raise exception 'Este préstamo es tuyo' using errcode = '22023';
  end if;

  perform public.respond_confirmation(p_token);

  insert into loans (owner_id, dir, card, set_code, person, qty, value, foil, due, confirmed_at, created_at,
                     source_loan_id, scryfall_id, image_url, photo_path)
  select v_uid, 'in', l.card, l.set_code, left(coalesce(nullif(c.sender_name, ''), 'Alguien'), 100),
         l.qty, l.value, l.foil, l.due, now(), l.created_at, l.id, l.scryfall_id, l.image_url, l.photo_path
    from loans l
   where l.id = any(c.loan_ids) and l.owner_id = c.owner_id and l.returned_at is null
  on conflict (owner_id, source_loan_id) where source_loan_id is not null do nothing;
  get diagnostics v_n = row_count;

  return json_build_object('added', v_n, 'confirmation', public.get_confirmation(p_token));
end;
$$;

revoke all on function public.claim_confirmation(text) from public, anon;
grant execute on function public.claim_confirmation(text) to authenticated;
grant execute on function public.get_confirmation(text) to anon, authenticated;
