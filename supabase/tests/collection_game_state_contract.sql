-- Regression contract for collection game state and reward claims.
-- Expected behavior after the matching migration is applied:
-- 1. get_my_collection_game_state resolves the stable anonymous identity.
-- 2. claimed contains persisted reward keys for that stable identity.
-- 3. xp includes both unlocked-egg XP and claimed reward XP.
-- 4. delivered partner-triggered eggs are included in unlocked egg_kinds.
-- 5. historical chat messages can backfill eggs that played before event persistence.
-- 6. chat easter egg writes use the stable identity after account recovery.
-- 7. claim_collection_reward writes against the stable identity and is idempotent.

do $$
declare
  state_def text;
  claim_def text;
begin
  select pg_get_functiondef('public.get_my_collection_game_state()'::regprocedure) into state_def;
  if state_def not ilike '%collection_reward_claims%' or state_def not ilike '%claimed%' or state_def not ilike '%sum(xp_awarded)%' then
    raise exception 'get_my_collection_game_state must return persisted claims and include reward XP';
  end if;
  if state_def not ilike '%chat_easter_egg_deliveries%' then
    raise exception 'get_my_collection_game_state must include delivered partner-triggered eggs';
  end if;
  if state_def not ilike '%random_chat_messages%' or state_def not ilike '%regexp_replace%' then
    raise exception 'get_my_collection_game_state must backfill triggered eggs from chat history';
  end if;

  select pg_get_functiondef('public.record_chat_easter_egg_event(uuid,text,text)'::regprocedure) into state_def;
  if state_def not ilike '%resolve_active_anonymous_chat_identity%' or state_def ilike '%caller uuid := auth.uid()%' then
    raise exception 'record_chat_easter_egg_event must use stable anonymous identity';
  end if;

  select pg_get_functiondef('public.claim_collection_reward(text)'::regprocedure) into claim_def;
  if claim_def not ilike '%resolve_active_anonymous_chat_identity%' then
    raise exception 'claim_collection_reward must use stable anonymous identity';
  end if;
  if claim_def not ilike '%on conflict do nothing%' then
    raise exception 'claim_collection_reward must remain idempotent';
  end if;
end $$;
