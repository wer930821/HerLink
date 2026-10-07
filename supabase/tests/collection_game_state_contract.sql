-- Regression contract for collection game state and reward claims.
-- Expected behavior after the matching migration is applied:
-- 1. get_my_collection_game_state resolves the stable anonymous identity.
-- 2. claimed contains persisted reward keys for that stable identity.
-- 3. xp includes both unlocked-egg XP and claimed reward XP.
-- 4. claim_collection_reward writes against the stable identity and is idempotent.

do $$
declare
  state_def text;
  claim_def text;
begin
  select pg_get_functiondef('public.get_my_collection_game_state()'::regprocedure) into state_def;
  if state_def not ilike '%collection_reward_claims%' or state_def not ilike '%claimed%' or state_def not ilike '%sum(xp_awarded)%' then
    raise exception 'get_my_collection_game_state must return persisted claims and include reward XP';
  end if;

  select pg_get_functiondef('public.claim_collection_reward(text)'::regprocedure) into claim_def;
  if claim_def not ilike '%resolve_active_anonymous_chat_identity%' then
    raise exception 'claim_collection_reward must use stable anonymous identity';
  end if;
  if claim_def not ilike '%on conflict do nothing%' then
    raise exception 'claim_collection_reward must remain idempotent';
  end if;
end $$;
