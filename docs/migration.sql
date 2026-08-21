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
      trust_score INTEGER DEFAULT 50, -- 新帳號預設改為 50
      onboarding_completed BOOLEAN DEFAULT FALSE,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
    );
  END IF;

  -- 欄位安全升級
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='profiles' and column_name='onboarding_completed') THEN
      ALTER TABLE profiles ADD COLUMN onboarding_completed BOOLEAN DEFAULT FALSE;
  END IF;
END
$$ LANGUAGE plpgsql;

-- 2. 開啟 profiles RLS
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

-- 3. 設定 profiles RLS 策略 (用戶只能 SELECT/INSERT/UPDATE 自己)
-- 確保底層 profiles 表是絕對私有的，任何人都無法直接 SELECT 别人的私人 Row (包括 birthday, trust_score, account_status)
DROP POLICY IF EXISTS "Users can only select their own profile" ON profiles;
CREATE POLICY "Users can only select their own profile" ON profiles 
  FOR SELECT USING (auth.uid() = id);

DROP POLICY IF EXISTS "Users can insert their own profile" ON profiles;
CREATE POLICY "Users can insert their own profile" ON profiles 
  FOR INSERT WITH CHECK (auth.uid() = id);

DROP POLICY IF EXISTS "Users can update their own profile" ON profiles;
CREATE POLICY "Users can update their own profile" ON profiles 
  FOR UPDATE USING (auth.uid() = id);

-- 4. 建立安全保護 Trigger 
-- 僅限在 Client (authenticated/anon) API 請求下進行欄位防篡改
-- 透過檢查 auth.role() 確保 service_role / 直接 SQL 管理員操作不被 Trigger 限制
CREATE OR REPLACE FUNCTION check_profile_write() RETURNS TRIGGER AS $$
BEGIN
  -- 如果是 API 用戶請求 (authenticated 或 anon)
  IF auth.role() = 'authenticated' OR auth.role() = 'anon' THEN
    IF TG_OP = 'INSERT' THEN
      NEW.verified := FALSE;
      NEW.trust_score := 50; -- 新帳號強制預設為 50
      NEW.account_status := 'active';
    ELSIF TG_OP = 'UPDATE' THEN
      -- 禁止變更 verified, trust_score, account_status 敏感欄位
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

-- 5. 建立安全 View (public_profiles)
-- 採用 security_invoker = false。這會使 View 以建立者 (postgres 特權帳號) 的身分查詢底層 profiles，從而繞過 profiles 的 RLS。
-- 但是，我們在 View 定義內部與權限上實施極嚴格的防禦：
DROP VIEW IF EXISTS public_profiles;
CREATE OR REPLACE VIEW public_profiles WITH (security_invoker = false) AS
SELECT
  id,
  display_name,
  date_part('year', age(birthday))::int AS age, -- 生日脫敏：只暴露計算後的年齡
  city,
  bio,
  orientation,
  identity_label,
  relationship_goals,
  interests,
  verified
FROM profiles
WHERE auth.role() = 'authenticated' -- 1. 只有 authenticated 用戶才允許看
  AND account_status = 'active'     -- 2. 只有 active 用戶才允許出現在 View 中
  AND onboarding_completed = TRUE;   -- 3. 只有完成 onboarding 的用戶才被拉取

-- 6. View 權限隔離設計 (最少權限原則)
-- 撤銷 public 與 anon 的所有 View 權限
REVOKE ALL ON public_profiles FROM public, anon;
-- 僅賦予 authenticated 與 service_role SELECT 權限
GRANT SELECT ON public_profiles TO authenticated, service_role;
