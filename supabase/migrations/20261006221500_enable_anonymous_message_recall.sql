-- Enable message recall for every authenticated chat user.
-- Authorization remains sender-owned: the RPC can only recall the caller's own message.

create or replace function public.recall_random_message(p_message_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $function$
declare
  actor_id uuid := auth.uid();
  target public.random_chat_messages%rowtype;
begin
  if actor_id is null then raise exception 'Authentication required.'; end if;

  select * into target
  from public.random_chat_messages
  where id = p_message_id
  for update;

  if not found then raise exception 'Message not found.'; end if;
  if target.sender_id <> actor_id then
    raise exception 'You can only recall your own message.';
  end if;
  if target.recalled_at is not null then return true; end if;

  update public.random_chat_messages
  set recalled_at = timezone('utc', now()),
      content = '此訊息已收回',
      message_type = 'text',
      media_path = null,
      media_mime = null,
      media_size = null,
      media_width = null,
      media_height = null
  where id = p_message_id;

  return true;
end
$function$;
