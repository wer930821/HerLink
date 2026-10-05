-- Track per-user read state for retained anonymous conversations.
create table if not exists public.random_chat_session_reads (
  session_id uuid not null references public.random_chat_sessions(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  last_read_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  primary key (session_id, user_id)
);
alter table public.random_chat_session_reads enable row level security;
-- Production migration also installs owner-only RLS policies, mark_random_session_read(uuid),
-- extends list_my_anonymous_contacts() with current_session_id, last_message_preview,
-- last_message_at and unread_count, and initializes existing retained chats as read.
