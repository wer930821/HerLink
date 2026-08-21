-- 1. 建立 profiles 資料表 (如果不存在)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'profiles') THEN
    CREATE TABLE profiles (
      id UUID REFERENCES auth.users ON DELETE CASCADE PRIMARY KEY,
      display_name TEXT,
      birthday DATE,
      city TEXT,
      bio TEXT,
      orientation TEXT,
      identity_label TEXT,
      relationship_goals TEXT[],
      interests TEXT[],
      verified BOOLEAN DEFAULT FALSE,
      account_status TEXT DEFAULT 'active',
      trust_score INTEGER DEFAULT 50,
      onboarding_completed BOOLEAN DEFAULT FALSE,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
    );
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='profiles' and column_name='onboarding_completed') THEN
      ALTER TABLE profiles ADD COLUMN onboarding_completed BOOLEAN DEFAULT FALSE;
  END IF;
END
$$ LANGUAGE plpgsql;

ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can only select their own profile" ON profiles;
CREATE POLICY "Users can only select their own profile" ON profiles
  FOR SELECT USING (auth.uid() = id);

DROP POLICY IF EXISTS "Users can insert their own profile" ON profiles;
CREATE POLICY "Users can insert their own profile" ON profiles
  FOR INSERT WITH CHECK (auth.uid() = id);

DROP POLICY IF EXISTS "Users can update their own profile" ON profiles;
CREATE POLICY "Users can update their own profile" ON profiles
  FOR UPDATE USING (auth.uid() = id);

CREATE OR REPLACE FUNCTION check_profile_write() RETURNS TRIGGER AS $$
BEGIN
  IF auth.role() = 'authenticated' OR auth.role() = 'anon' THEN
    IF TG_OP = 'INSERT' THEN
      NEW.verified := FALSE;
      NEW.trust_score := 50;
      NEW.account_status := 'active';
    ELSIF TG_OP = 'UPDATE' THEN
      IF NEW.verified IS DISTINCT FROM OLD.verified OR
         NEW.trust_score IS DISTINCT FROM OLD.trust_score OR
         NEW.account_status IS DISTINCT FROM OLD.account_status THEN
        RAISE EXCEPTION 'You are not allowed to modify verified, trust_score, or account_status.';
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS check_profile_write_trigger ON profiles;
CREATE TRIGGER check_profile_write_trigger
BEFORE INSERT OR UPDATE ON profiles
FOR EACH ROW EXECUTE FUNCTION check_profile_write();

DROP VIEW IF EXISTS public_profiles;
CREATE OR REPLACE VIEW public_profiles WITH (security_invoker = false) AS
SELECT
  id,
  display_name,
  date_part('year', age(birthday))::int AS age,
  city,
  bio,
  orientation,
  identity_label,
  relationship_goals,
  interests,
  verified
FROM profiles
WHERE auth.role() = 'authenticated'
  AND account_status = 'active'
  AND onboarding_completed = TRUE;

REVOKE ALL ON public_profiles FROM public, anon;
GRANT SELECT ON public_profiles TO authenticated, service_role;
