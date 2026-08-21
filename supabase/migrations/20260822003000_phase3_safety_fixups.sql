CREATE OR REPLACE FUNCTION public.send_message(
  p_match_id UUID,
  p_content TEXT
)
RETURNS TABLE (
  id UUID,
  match_id UUID,
  sender_id UUID,
  type TEXT,
  content TEXT,
  created_at TIMESTAMPTZ,
  read_at TIMESTAMPTZ,
  safety_warning TEXT,
  risk_level TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  actor_id UUID := auth.uid();
  other_user_id UUID;
  match_row public.matches%ROWTYPE;
  inserted_row public.messages%ROWTYPE;
  message_text TEXT := BTRIM(COALESCE(p_content, ''));
  request_signal BOOLEAN;
  external_signal BOOLEAN;
  investment_signal BOOLEAN;
  investment_high_signal BOOLEAN;
  money_signal BOOLEAN;
  credential_signal BOOLEAN;
  repeated_signal BOOLEAN := FALSE;
  mass_signal BOOLEAN := FALSE;
  detected_event_type TEXT := NULL;
  detected_warning TEXT := NULL;
  detected_risk_level TEXT := 'low';
BEGIN
  IF actor_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required.';
  END IF;

  IF message_text = '' THEN
    RAISE EXCEPTION 'Message content cannot be empty.';
  END IF;

  SELECT *
  INTO match_row
  FROM public.matches
  WHERE public.matches.id = p_match_id
    AND public.matches.status = 'active'
    AND (public.matches.user_1_id = actor_id OR public.matches.user_2_id = actor_id);

  IF NOT FOUND THEN
    RAISE EXCEPTION 'This conversation is not available.';
  END IF;

  other_user_id := CASE
    WHEN match_row.user_1_id = actor_id THEN match_row.user_2_id
    ELSE match_row.user_1_id
  END;

  IF public.has_block_between(actor_id, other_user_id) THEN
    RAISE EXCEPTION 'This conversation is not available.';
  END IF;

  request_signal := lower(message_text) ~ '(給我|傳給我|提供|借我|幫我|加我|聯絡我|私訊我|發我|告訴我)';
  external_signal := lower(message_text) ~ '(https?://|www\\.|t\\.me/|telegram|line群|line group|line)';
  investment_signal := lower(message_text) ~ '(投資|虛擬貨幣|usdt|交易所|帶你操作|穩賺)';
  investment_high_signal := lower(message_text) ~ '(保證獲利|帶你操作|穩賺)' OR (
    lower(message_text) ~ '(投資|usdt|虛擬貨幣|交易所)'
    AND lower(message_text) ~ '(保證獲利|帶你操作|穩賺|獲利)'
  );
  money_signal := lower(message_text) ~ '(匯款|轉帳|借錢|銀行帳號|atm|代付|儲值)';
  credential_signal := lower(message_text) ~ '(otp|驗證碼|密碼)';

  SELECT EXISTS (
    SELECT 1
    FROM public.messages AS existing_message
    WHERE existing_message.match_id = p_match_id
      AND existing_message.sender_id = actor_id
      AND lower(existing_message.content) = lower(message_text)
      AND existing_message.created_at >= timezone('utc'::text, now()) - interval '1 day'
  )
  INTO repeated_signal;

  SELECT COUNT(DISTINCT existing_message.match_id) >= 3
  INTO mass_signal
  FROM public.messages AS existing_message
  WHERE existing_message.sender_id = actor_id
    AND lower(existing_message.content) = lower(message_text)
    AND existing_message.created_at >= timezone('utc'::text, now()) - interval '1 day';

  IF investment_signal AND investment_high_signal THEN
    detected_risk_level := 'high';
    detected_warning := '這則訊息包含高風險投資話術，請提高警覺。';
    detected_event_type := 'suspicious_investment_message';
  ELSIF credential_signal AND request_signal THEN
    detected_risk_level := 'high';
    detected_warning := '這則訊息要求敏感驗證資訊，請不要提供。';
    detected_event_type := 'credential_request';
  ELSIF money_signal AND request_signal THEN
    detected_risk_level := 'medium';
    detected_warning := '這則訊息包含金錢往來請求，請提高警覺。';
    detected_event_type := 'suspicious_money_message';
  ELSIF external_signal AND request_signal THEN
    detected_risk_level := 'medium';
    detected_warning := '這則訊息引導到外部平台，請先確認對方身分。';
    detected_event_type := 'suspicious_external_link';
  ELSIF repeated_signal THEN
    detected_risk_level := 'medium';
    detected_warning := '這則訊息與近期內容高度重複，系統已記錄安全事件。';
    detected_event_type := 'repeated_message';
  ELSIF mass_signal THEN
    detected_risk_level := 'medium';
    detected_warning := '這則訊息短時間內被大量重複發送，系統已記錄安全事件。';
    detected_event_type := 'mass_messaging';
  END IF;

  INSERT INTO public.messages (match_id, sender_id, type, content)
  VALUES (p_match_id, actor_id, 'text', message_text)
  RETURNING * INTO inserted_row;

  IF detected_event_type IS NOT NULL THEN
    PERFORM public.apply_risk_event(
      actor_id,
      detected_event_type,
      jsonb_build_object(
        'match_id', p_match_id,
        'target_user_id', other_user_id,
        'content_preview', LEFT(message_text, 120),
        'risk_level', detected_risk_level
      )
    );
  END IF;

  RETURN QUERY
  SELECT
    inserted_row.id,
    inserted_row.match_id,
    inserted_row.sender_id,
    inserted_row.type,
    inserted_row.content,
    inserted_row.created_at,
    inserted_row.read_at,
    detected_warning,
    detected_risk_level;
END;
$$;

REVOKE INSERT, UPDATE, DELETE ON public.blocks FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.reports FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.risk_events FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.messages FROM authenticated;
