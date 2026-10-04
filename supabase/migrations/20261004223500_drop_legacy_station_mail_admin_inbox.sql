-- Remove the legacy no-argument overload after mailbox gained the p_trash selector.
-- Keeping both overloads can make PostgREST RPC resolution ambiguous.
drop function if exists public.station_mail_admin_inbox();
notify pgrst, 'reload schema';
