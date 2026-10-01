-- Relax anonymous abuse thresholds to reduce false positives caused by repeated
-- anonymous session recreation, while retaining stronger protections for reports,
-- blocks, fraud signals, and sustained abusive behavior.

do $$
declare
  ddl text;
begin
  select pg_get_functiondef(p.oid)
  into ddl
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname = 'refresh_anonymous_abuse_status_by_key'
  limit 1;

  ddl := replace(ddl, '(rotation_count * 4)', '(rotation_count)');
  ddl := replace(ddl, '(GREATEST(queue_join_count - 3, 0))', '(GREATEST(queue_join_count - 8, 0))');
  ddl := replace(ddl, '(GREATEST(queue_leave_count + session_leave_count - 4, 0))', '(GREATEST(queue_leave_count + session_leave_count - 6, 0))');
  ddl := replace(ddl, '(GREATEST(next_match_count - 2, 0) * 2)', '(GREATEST(next_match_count - 4, 0))');
  ddl := replace(ddl, '(report_received_count * 2)', '(report_received_count * 3)');
  ddl := replace(ddl, '(block_received_count * 2)', '(block_received_count * 3)');
  ddl := replace(ddl, '(fraud_high_count * 4)', '(fraud_high_count * 5)');
  ddl := replace(ddl, '(fraud_critical_count * 6)', '(fraud_critical_count * 10)');

  ddl := replace(ddl,
    'ELSIF computed_score >= 10
    OR rotation_count >= 3
    OR rotation_recent_count >= 3
    OR report_received_count >= 5
    OR block_received_count >= 3
    OR fraud_critical_count >= 1 THEN',
    'ELSIF computed_score >= 18
    OR rotation_count >= 8
    OR rotation_recent_count >= 6
    OR report_received_count >= 5
    OR block_received_count >= 4
    OR fraud_critical_count >= 1 THEN'
  );

  ddl := replace(ddl,
    'ELSIF computed_score >= 5
    OR rotation_count >= 2
    OR rotation_recent_count >= 2
    OR report_received_count >= 3
    OR block_received_count >= 2
    OR fraud_high_count >= 2
    OR (queue_join_count >= 6 AND next_match_count >= 2) THEN',
    'ELSIF computed_score >= 10
    OR rotation_count >= 4
    OR rotation_recent_count >= 4
    OR report_received_count >= 3
    OR block_received_count >= 2
    OR fraud_high_count >= 2
    OR (queue_join_count >= 12 AND next_match_count >= 6) THEN'
  );

  execute ddl;
end
$$;

-- Clear only active automated restrictions that have no report/block/critical-fraud
-- evidence in the previous 24 hours.
update public.anonymous_risk_identities i
set
  cooldown_until = null,
  temporary_suspension_until = null,
  enforcement_set_at = null,
  last_decision = 'allow',
  last_reason_code = null,
  review_required = false
where
  (i.cooldown_until > now() or i.temporary_suspension_until > now())
  and not exists (
    select 1
    from public.anonymous_risk_events e
    where e.installation_key = i.installation_key
      and e.created_at >= now() - interval '24 hours'
      and e.event_type in ('report_received', 'block_received', 'fraud_critical')
  );
