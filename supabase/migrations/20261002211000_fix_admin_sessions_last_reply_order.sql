-- Keep the admin session list in deterministic descending order.
-- "last_reply" means the newest message is always shown first.

CREATE OR REPLACE FUNCTION public.list_admin_random_sessions(
  p_status text DEFAULT NULL::text,
  p_offset integer DEFAULT 0,
  p_limit integer DEFAULT 20,
  p_sort text DEFAULT 'newest'::text
)
RETURNS TABLE(
  id uuid,
  created_at timestamptz,
  status text,
  user_a uuid,
  user_b uuid,
  ended_at timestamptz,
  ended_reason text,
  message_count bigint,
  first_message_at timestamptz,
  last_message_at timestamptz,
  total_count bigint
)
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
WITH rows AS (
  SELECT s.id,s.created_at,s.status,s.user_a,s.user_b,s.ended_at,s.ended_reason,
         count(m.id)::bigint message_count,min(m.created_at) first_message_at,max(m.created_at) last_message_at
  FROM random_chat_sessions s
  LEFT JOIN random_chat_messages m ON m.session_id=s.id
  WHERE p_status IS NULL OR s.status=p_status
  GROUP BY s.id
), ranked AS (
  SELECT rows.*,count(*) OVER() total_count FROM rows
)
SELECT id,created_at,status,user_a,user_b,ended_at,ended_reason,message_count,first_message_at,last_message_at,total_count
FROM ranked
ORDER BY
  CASE WHEN p_sort='last_reply' THEN last_message_at END DESC NULLS LAST,
  CASE WHEN p_sort='last_reply' THEN created_at END DESC,
  CASE WHEN p_sort<>'last_reply' THEN created_at END DESC,
  id DESC
OFFSET greatest(p_offset,0)
LIMIT least(greatest(p_limit,1),100);
$function$;
