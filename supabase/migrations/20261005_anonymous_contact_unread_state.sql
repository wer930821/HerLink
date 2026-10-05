create table if not exists public.random_chat_session_reads (
  session_id uuid not null references public.random_chat_sessions(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  last_read_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  primary key (session_id, user_id)
);
alter table public.random_chat_session_reads enable row level security;
drop policy if exists "random_chat_session_reads_select_own" on public.random_chat_session_reads;
create policy "random_chat_session_reads_select_own" on public.random_chat_session_reads for select to authenticated using ((select auth.uid()) = user_id);
drop policy if exists "random_chat_session_reads_insert_own" on public.random_chat_session_reads;
create policy "random_chat_session_reads_insert_own" on public.random_chat_session_reads for insert to authenticated with check ((select auth.uid()) = user_id and exists (select 1 from public.random_chat_sessions s where s.id = session_id and ((select auth.uid()) = s.user_a or (select auth.uid()) = s.user_b)));
drop policy if exists "random_chat_session_reads_update_own" on public.random_chat_session_reads;
create policy "random_chat_session_reads_update_own" on public.random_chat_session_reads for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

insert into public.random_chat_session_reads(session_id,user_id,last_read_at,updated_at)
select s.id,u.user_id,timezone('utc',now()),timezone('utc',now())
from public.random_chat_sessions s
cross join lateral (values (s.user_a),(s.user_b)) u(user_id)
join public.anonymous_contacts c on c.status='active' and c.user_a_approved=true and c.user_b_approved=true and c.user_a=s.user_a and c.user_b=s.user_b
on conflict(session_id,user_id) do nothing;

create or replace function public.mark_random_session_read(p_session_id uuid)
returns boolean language plpgsql security definer set search_path to 'public' as $$
declare actor_id uuid := auth.uid();
begin
  if actor_id is null then raise exception 'Authentication required.'; end if;
  if not exists (select 1 from public.random_chat_sessions s where s.id=p_session_id and (s.user_a=actor_id or s.user_b=actor_id)) then raise exception 'This session is not available.'; end if;
  insert into public.random_chat_session_reads(session_id,user_id,last_read_at,updated_at)
  values(p_session_id,actor_id,timezone('utc',now()),timezone('utc',now()))
  on conflict(session_id,user_id) do update set last_read_at=excluded.last_read_at,updated_at=excluded.updated_at;
  return true;
end; $$;
revoke all on function public.mark_random_session_read(uuid) from public;
grant execute on function public.mark_random_session_read(uuid) to authenticated;

drop function if exists public.list_my_anonymous_contacts();
create function public.list_my_anonymous_contacts()
returns table(contact_id uuid,source_session_id uuid,status text,partner_user_id uuid,partner_anonymous_display_name text,partner_anonymous_avatar text,partner_verified boolean,my_approved boolean,partner_approved boolean,created_at timestamptz,activated_at timestamptz,current_session_id uuid,last_message_preview text,last_message_at timestamptz,unread_count bigint)
language sql stable security definer set search_path to 'public' as $$
select c.id,c.source_session_id,c.status,partner.id,
coalesce(nullif(btrim(partner.anonymous_display_name),''),'匿名使用者'),
coalesce(nullif(btrim(partner.anonymous_avatar),''),'avatar_01'),coalesce(partner.verified,false),
case when auth.uid()=c.user_a then c.user_a_approved else c.user_b_approved end,
case when auth.uid()=c.user_a then c.user_b_approved else c.user_a_approved end,
c.created_at,c.activated_at,s.id,
case when lm.id is null then null when lm.message_type='image' then '傳送了一張照片' else left(coalesce(lm.content,''),80) end,
lm.created_at,coalesce(uc.unread_count,0)
from public.anonymous_contacts c
join public.profiles partner on partner.id=case when auth.uid()=c.user_a then c.user_b else c.user_a end
left join public.random_chat_sessions s on s.user_a=c.user_a and s.user_b=c.user_b
left join lateral (select m.id,m.content,m.message_type,m.created_at from public.random_chat_messages m where m.session_id=s.id order by m.created_at desc,m.id desc limit 1) lm on true
left join lateral (select count(*)::bigint unread_count from public.random_chat_messages m left join public.random_chat_session_reads r on r.session_id=s.id and r.user_id=auth.uid() where m.session_id=s.id and m.sender_id<>auth.uid() and m.created_at>coalesce(r.last_read_at,c.activated_at,c.created_at)) uc on true
where auth.uid() is not null and (auth.uid()=c.user_a or auth.uid()=c.user_b) and c.status<>'removed' and partner.account_status='active' and not public.has_block_between(auth.uid(),partner.id)
order by case when coalesce(uc.unread_count,0)>0 then 0 else 1 end,coalesce(lm.created_at,c.activated_at,c.updated_at) desc,c.id desc;
$$;
revoke all on function public.list_my_anonymous_contacts() from public;
grant execute on function public.list_my_anonymous_contacts() to authenticated;
