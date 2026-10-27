-- Actualización 003: cuando el dueño confirma en el link que recibió sus cartas,
-- el préstamo también queda marcado como devuelto en la cuenta de quien las devolvió.
-- Pégalo en Supabase > SQL Editor > New query y pulsa "Run". Se puede ejecutar más de una vez.

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
