-- Actualización 002: "Guardar en mi cuenta" desde el link de confirmación
-- Pégalo en Supabase > SQL Editor > New query y pulsa "Run". Se puede ejecutar más de una vez.

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
