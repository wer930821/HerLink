alter table public.random_chat_messages
  add column if not exists edited_at timestamptz;

create or replace function public.edit_random_message(p_message_id uuid, p_content text)
returns void
language plpgsql
security definer
set search_path = 'public'
as $function$
declare
  actor_id uuid := public.resolve_active_anonymous_chat_identity();
  target public.random_chat_messages%rowtype;
  cleaned_content text := btrim(coalesce(p_content, ''));
  detected_risk_level text := 'low';
  detected_risk_types text[] := array[]::text[];
begin
  if actor_id is null then raise exception 'Authentication required.'; end if;
  if cleaned_content = '' then raise exception 'Message cannot be blank.'; end if;
  if length(cleaned_content) > 2000 then raise exception 'Message is too long.'; end if;

  select * into target
  from public.random_chat_messages
  where id = p_message_id
  for update;

  if not found then raise exception 'Message not found.'; end if;
  if target.sender_id <> actor_id then raise exception 'You can only edit your own message.'; end if;
  if target.message_type <> 'text' then raise exception 'Only text messages can be edited.'; end if;
  if target.recalled_at is not null then raise exception 'Recalled messages cannot be edited.'; end if;
  if cleaned_content = target.content then return; end if;

  select risk_row.risk_level, risk_row.risk_types
  into detected_risk_level, detected_risk_types
  from public.analyze_random_message_risk(cleaned_content) as risk_row;

  update public.random_chat_messages
  set content = cleaned_content,
      edited_at = timezone('utc', now()),
      risk_level = detected_risk_level,
      risk_types = coalesce(detected_risk_types, array[]::text[])
  where id = p_message_id;
end;
$function$;

revoke all on function public.edit_random_message(uuid, text) from public;
grant execute on function public.edit_random_message(uuid, text) to authenticated;
