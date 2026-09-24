-- Mutual anonymous contacts for HerLink random chat.
create table if not exists public.anonymous_contacts (
  id uuid primary key default gen_random_uuid(),
  user_a uuid not null references public.profiles(id) on delete cascade,
  user_b uuid not null references public.profiles(id) on delete cascade,
  source_session_id uuid references public.random_chat_sessions(id) on delete set null,
  requested_by uuid not null references public.profiles(id) on delete cascade,
  user_a_approved boolean not null default false,
  user_b_approved boolean not null default false,
  status text not null default 'pending' check (status in ('pending','active','removed')),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  activated_at timestamptz,
  constraint anonymous_contacts_canonical_pair check (user_a < user_b),
  constraint anonymous_contacts_unique_pair unique (user_a, user_b)
);

alter table public.anonymous_contacts enable row level security;
drop policy if exists anonymous_contacts_select_own on public.anonymous_contacts;
create policy anonymous_contacts_select_own on public.anonymous_contacts
for select to authenticated
using ((select auth.uid()) = user_a or (select auth.uid()) = user_b);
grant select on public.anonymous_contacts to authenticated;
revoke insert, update, delete on public.anonymous_contacts from anon, authenticated;

create or replace function public.request_anonymous_contact(p_session_id uuid)
returns table(contact_id uuid,status text,my_approved boolean,partner_approved boolean)
language plpgsql security definer set search_path=public
as $function$
declare
  actor_id uuid := auth.uid();
  s public.random_chat_sessions%rowtype;
  partner_id uuid;
  a uuid;
  b uuid;
  row_ref public.anonymous_contacts%rowtype;
begin
  if actor_id is null then raise exception 'Authentication required.'; end if;
  select * into s from public.random_chat_sessions
  where id=p_session_id and (user_a=actor_id or user_b=actor_id);
  if not found then raise exception 'This session is not available.'; end if;

  partner_id := case when s.user_a=actor_id then s.user_b else s.user_a end;
  if public.has_block_between(actor_id, partner_id) then
    raise exception 'This connection is no longer available.';
  end if;
  if (select count(*) from public.profiles p
      where p.id in (actor_id,partner_id) and p.account_status='active') <> 2 then
    raise exception 'This connection is no longer available.';
  end if;

  a:=least(actor_id,partner_id);
  b:=greatest(actor_id,partner_id);

  insert into public.anonymous_contacts(
    user_a,user_b,source_session_id,requested_by,
    user_a_approved,user_b_approved,status,updated_at
  ) values (
    a,b,p_session_id,actor_id,actor_id=a,actor_id=b,'pending',timezone('utc',now())
  )
  on conflict (user_a,user_b) do update set
    source_session_id=coalesce(public.anonymous_contacts.source_session_id,excluded.source_session_id),
    requested_by=case when public.anonymous_contacts.status='removed' then excluded.requested_by else public.anonymous_contacts.requested_by end,
    user_a_approved=case when excluded.user_a_approved then true when public.anonymous_contacts.status='removed' then false else public.anonymous_contacts.user_a_approved end,
    user_b_approved=case when excluded.user_b_approved then true when public.anonymous_contacts.status='removed' then false else public.anonymous_contacts.user_b_approved end,
    status='pending',updated_at=timezone('utc',now())
  returning * into row_ref;

  if row_ref.user_a_approved and row_ref.user_b_approved then
    update public.anonymous_contacts
    set status='active',
        activated_at=coalesce(activated_at,timezone('utc',now())),
        updated_at=timezone('utc',now())
    where id=row_ref.id returning * into row_ref;
  end if;

  return query select row_ref.id,row_ref.status,
    case when actor_id=row_ref.user_a then row_ref.user_a_approved else row_ref.user_b_approved end,
    case when actor_id=row_ref.user_a then row_ref.user_b_approved else row_ref.user_a_approved end;
end;
$function$;
revoke all on function public.request_anonymous_contact(uuid) from public,anon;
grant execute on function public.request_anonymous_contact(uuid) to authenticated;

create or replace function public.get_anonymous_contact_status(p_session_id uuid)
returns table(contact_id uuid,status text,my_approved boolean,partner_approved boolean)
language sql stable security definer set search_path=public
as $function$
  with session_row as (
    select s.user_a,s.user_b from public.random_chat_sessions s
    where s.id=p_session_id and auth.uid() is not null
      and (s.user_a=auth.uid() or s.user_b=auth.uid()) limit 1
  )
  select c.id,c.status,
    case when auth.uid()=c.user_a then c.user_a_approved else c.user_b_approved end,
    case when auth.uid()=c.user_a then c.user_b_approved else c.user_a_approved end
  from public.anonymous_contacts c
  join session_row s
    on c.user_a=least(s.user_a,s.user_b) and c.user_b=greatest(s.user_a,s.user_b)
  where c.status<>'removed' limit 1;
$function$;
revoke all on function public.get_anonymous_contact_status(uuid) from public,anon;
grant execute on function public.get_anonymous_contact_status(uuid) to authenticated;

create or replace function public.list_my_anonymous_contacts()
returns table(
  contact_id uuid,source_session_id uuid,status text,partner_user_id uuid,
  partner_anonymous_display_name text,partner_anonymous_avatar text,
  partner_verified boolean,my_approved boolean,partner_approved boolean,
  created_at timestamptz,activated_at timestamptz
)
language sql stable security definer set search_path=public
as $function$
  select c.id,c.source_session_id,c.status,partner.id,
    coalesce(nullif(btrim(partner.anonymous_display_name),''),'匿名使用者'),
    coalesce(nullif(btrim(partner.anonymous_avatar),''),'avatar_01'),
    coalesce(partner.verified,false),
    case when auth.uid()=c.user_a then c.user_a_approved else c.user_b_approved end,
    case when auth.uid()=c.user_a then c.user_b_approved else c.user_a_approved end,
    c.created_at,c.activated_at
  from public.anonymous_contacts c
  join public.profiles partner
    on partner.id=case when auth.uid()=c.user_a then c.user_b else c.user_a end
  where auth.uid() is not null
    and (auth.uid()=c.user_a or auth.uid()=c.user_b)
    and c.status<>'removed'
    and partner.account_status='active'
    and not public.has_block_between(auth.uid(),partner.id)
  order by case when c.status='active' then 0 else 1 end,
    coalesce(c.activated_at,c.updated_at) desc,c.id desc;
$function$;
revoke all on function public.list_my_anonymous_contacts() from public,anon;
grant execute on function public.list_my_anonymous_contacts() to authenticated;

create or replace function public.remove_anonymous_contact(p_contact_id uuid)
returns boolean language plpgsql security definer set search_path=public
as $function$
declare actor_id uuid:=auth.uid(); changed integer:=0;
begin
  if actor_id is null then raise exception 'Authentication required.'; end if;
  update public.anonymous_contacts
  set status='removed',user_a_approved=false,user_b_approved=false,updated_at=timezone('utc',now())
  where id=p_contact_id and (user_a=actor_id or user_b=actor_id);
  get diagnostics changed=row_count;
  return changed>0;
end;
$function$;
revoke all on function public.remove_anonymous_contact(uuid) from public,anon;
grant execute on function public.remove_anonymous_contact(uuid) to authenticated;

create or replace function public.start_anonymous_contact_session(p_contact_id uuid)
returns table(status text,session_id uuid)
language plpgsql security definer set search_path=public
as $function$
declare
  actor_id uuid:=auth.uid();
  c public.anonymous_contacts%rowtype;
  partner_id uuid;
  existing_session uuid;
  new_session_id uuid;
begin
  if actor_id is null then raise exception 'Authentication required.'; end if;

  select * into c from public.anonymous_contacts
  where id=p_contact_id and status='active'
    and user_a_approved=true and user_b_approved=true
    and (user_a=actor_id or user_b=actor_id);
  if not found then raise exception 'Anonymous contact is not active.'; end if;

  partner_id:=case when c.user_a=actor_id then c.user_b else c.user_a end;
  if public.has_block_between(actor_id,partner_id) then
    raise exception 'This connection is no longer available.';
  end if;

  select s.id into existing_session from public.random_chat_sessions s
  where s.status='active'
    and s.user_a=least(actor_id,partner_id)
    and s.user_b=greatest(actor_id,partner_id)
  order by s.created_at desc limit 1;
  if existing_session is not null then
    return query select 'existing'::text,existing_session; return;
  end if;

  if exists(select 1 from public.random_chat_sessions s
    where s.status='active' and (s.user_a=actor_id or s.user_b=actor_id)) then
    raise exception 'You already have an active anonymous chat.';
  end if;
  if exists(select 1 from public.random_chat_sessions s
    where s.status='active' and (s.user_a=partner_id or s.user_b=partner_id)) then
    raise exception 'This contact is currently in another chat.';
  end if;

  new_session_id:=gen_random_uuid();
  insert into public.random_chat_sessions(id,user_a,user_b,status,created_at)
  values(new_session_id,least(actor_id,partner_id),greatest(actor_id,partner_id),'active',timezone('utc',now()));

  update public.random_match_queue
  set status='left',matched_session_id=null,updated_at=timezone('utc',now())
  where user_id in (actor_id,partner_id) and status='waiting';

  return query select 'created'::text,new_session_id;
end;
$function$;
revoke all on function public.start_anonymous_contact_session(uuid) from public,anon;
grant execute on function public.start_anonymous_contact_session(uuid) to authenticated;
