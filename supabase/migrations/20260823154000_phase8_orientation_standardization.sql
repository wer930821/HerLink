UPDATE public.profiles
SET orientation = NULL
WHERE orientation IS NOT NULL
  AND btrim(orientation) = '';

UPDATE public.profiles
SET orientation = 'Lesbian'
WHERE lower(btrim(COALESCE(orientation, ''))) IN ('lesbian', 'les', '女同志', '女同性戀');

UPDATE public.profiles
SET orientation = 'Bisexual'
WHERE lower(btrim(COALESCE(orientation, ''))) IN ('bisexual', 'bi', '雙性戀');

UPDATE public.profiles
SET orientation = 'Pansexual'
WHERE lower(btrim(COALESCE(orientation, ''))) IN ('pansexual', 'pan', '泛性戀');

UPDATE public.profiles
SET orientation = 'Asexual'
WHERE lower(btrim(COALESCE(orientation, ''))) IN ('asexual', 'ace', '無性戀');

UPDATE public.profiles
SET orientation = 'Queer'
WHERE lower(btrim(COALESCE(orientation, ''))) IN ('queer', '酷兒');

UPDATE public.profiles
SET orientation = 'Questioning'
WHERE lower(btrim(COALESCE(orientation, ''))) IN ('questioning', 'unsure', '不確定');

UPDATE public.profiles
SET orientation = 'Other'
WHERE lower(btrim(COALESCE(orientation, ''))) IN ('other', '其他');

UPDATE public.profiles
SET orientation = NULL
WHERE orientation IS NOT NULL
  AND orientation NOT IN ('Lesbian', 'Bisexual', 'Pansexual', 'Asexual', 'Queer', 'Questioning', 'Other');

ALTER TABLE public.profiles
  DROP CONSTRAINT IF EXISTS profiles_orientation_check;

ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_orientation_check
  CHECK (
    orientation IS NULL
    OR orientation IN ('Lesbian', 'Bisexual', 'Pansexual', 'Asexual', 'Queer', 'Questioning', 'Other')
  );
