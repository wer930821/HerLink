UPDATE public.profiles
SET identity_label = CASE
  WHEN identity_label IS NULL THEN NULL
  WHEN btrim(identity_label) = '' THEN NULL
  WHEN lower(btrim(identity_label)) = 'woman' THEN 'Woman'
  WHEN lower(btrim(identity_label)) IN ('non-binary', 'nonbinary') THEN 'Non-binary'
  WHEN lower(btrim(identity_label)) IN ('trans woman', 'transwoman') THEN 'Trans woman'
  WHEN btrim(identity_label) = '其他' THEN '其他'
  ELSE identity_label
END;

UPDATE public.profiles
SET interested_in_identity_labels = COALESCE((
  SELECT array_agg(DISTINCT normalized_value ORDER BY normalized_value)
  FROM (
    SELECT CASE
      WHEN raw_value IS NULL OR btrim(raw_value) = '' THEN NULL
      WHEN lower(btrim(raw_value)) = 'woman' THEN 'Woman'
      WHEN lower(btrim(raw_value)) IN ('non-binary', 'nonbinary') THEN 'Non-binary'
      WHEN lower(btrim(raw_value)) IN ('trans woman', 'transwoman') THEN 'Trans woman'
      WHEN btrim(raw_value) = '其他' THEN '其他'
      ELSE raw_value
    END AS normalized_value
    FROM unnest(COALESCE(interested_in_identity_labels, ARRAY[]::TEXT[])) AS raw_value
  ) normalized
  WHERE normalized_value IS NOT NULL
), ARRAY[]::TEXT[]);

ALTER TABLE public.profiles
  DROP CONSTRAINT IF EXISTS profiles_identity_label_valid_check;

ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_identity_label_valid_check
  CHECK (
    identity_label IS NULL
    OR identity_label IN ('Woman', 'Non-binary', 'Trans woman', '其他')
  );

ALTER TABLE public.profiles
  DROP CONSTRAINT IF EXISTS profiles_interested_in_identity_labels_valid_check;

ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_interested_in_identity_labels_valid_check
  CHECK (
    interested_in_identity_labels <@ ARRAY['Woman', 'Non-binary', 'Trans woman', '其他']::TEXT[]
  );
