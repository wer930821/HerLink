ALTER TABLE public.profiles
  DROP CONSTRAINT IF EXISTS profiles_identity_label_valid_check;

ALTER TABLE public.profiles
  DROP CONSTRAINT IF EXISTS profiles_interested_in_identity_labels_valid_check;

UPDATE public.profiles
SET identity_label = NULL
WHERE identity_label IN ('Woman', 'Non-binary', 'Trans woman');

-- Correct the previous rollout that mapped clear legacy values to Other.
-- We only null out "Other" when the row still looks like a migrated legacy profile:
-- no new T/P/H preference was selected, and the record predates the August 23, 2026 reselection flow.
UPDATE public.profiles
SET identity_label = NULL
WHERE identity_label = 'Other'
  AND created_at < TIMESTAMPTZ '2026-08-23 00:00:00+00'
  AND NOT EXISTS (
    SELECT 1
    FROM unnest(COALESCE(interested_in_identity_labels, ARRAY[]::TEXT[])) AS value
    WHERE value IN ('T', 'P', 'H')
  );

UPDATE public.profiles
SET interested_in_identity_labels = COALESCE((
  SELECT array_agg(value ORDER BY value)
  FROM (
    SELECT DISTINCT value
    FROM unnest(COALESCE(interested_in_identity_labels, ARRAY[]::TEXT[])) AS value
    WHERE value IN ('T', 'P', 'H', 'Other')
  ) valid_values
), ARRAY[]::TEXT[]);

-- If a pre-August-23 legacy row only kept Other after cleanup, force reselection instead of treating it as real Other.
UPDATE public.profiles
SET interested_in_identity_labels = ARRAY[]::TEXT[]
WHERE created_at < TIMESTAMPTZ '2026-08-23 00:00:00+00'
  AND interested_in_identity_labels = ARRAY['Other']::TEXT[];

ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_identity_label_valid_check
  CHECK (
    identity_label IS NULL
    OR identity_label IN ('T', 'P', 'H', 'Other')
  );

ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_interested_in_identity_labels_valid_check
  CHECK (
    interested_in_identity_labels <@ ARRAY['T', 'P', 'H', 'Other']::TEXT[]
  );
