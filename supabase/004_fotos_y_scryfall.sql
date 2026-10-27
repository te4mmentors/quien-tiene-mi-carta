-- Actualización 004: imagen oficial de la carta (Scryfall) y foto del estado de la carta
-- Pégalo en Supabase > SQL Editor > New query y pulsa "Run". Se puede ejecutar más de una vez.

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
