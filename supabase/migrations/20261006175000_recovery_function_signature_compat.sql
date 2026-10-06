-- These functions already exist in production with OUT signatures that differ from
-- the recovered-identity implementation. Drop them before the replacement migration;
-- the following migrations recreate them in the same migration batch.
DROP FUNCTION IF EXISTS public.list_random_messages(UUID, INTEGER);
DROP FUNCTION IF EXISTS public.send_random_message(UUID, TEXT);
DROP FUNCTION IF EXISTS public.report_random_user(UUID, TEXT, TEXT, BOOLEAN);
