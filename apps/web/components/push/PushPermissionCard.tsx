"use client";

import { useCallback, useEffect, useState } from "react";
import { Badge, Button, Notice, Surface } from "../ui";
import {
  getNotificationPermission,
  isIosSafariWithoutStandalone,
  isPushSupported,
  listenForSubscriptionChanges,
  requestPushPermission,
  syncPushSubscription,
  type PushPermissionState,
} from "../../lib/web-push";

export function PushPermissionCard() {
  const [state, setState] = useState<PushPermissionState>("default");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [iosHint] = useState(() => isIosSafariWithoutStandalone());

  useEffect(() => {
    if (!isPushSupported()) {
      setState("unsupported");
      return;
    }

    setState(getNotificationPermission());
    void listenForSubscriptionChanges();

    if (Notification.permission === "granted") {
      void syncPushSubscription();
    }
  }, []);

  const enable = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const next = await requestPushPermission();
      setState(next);
      if (next === "denied") {
        setError("通知權限已關閉，請到瀏覽器網站設定中重新開啟。");
      } else if (next === "default") {
        setError("尚未完成通知設定，請再試一次。");
      }
    } catch {
      setState(getNotificationPermission());
      setError("開啟通知時發生問題，請稍後再試。");
    } finally {
      setBusy(false);
    }
  }, []);

  if (state === "unsupported") {
    return null;
  }

  if (state === "granted") {
    return (
      <Surface elevation="inset">
        <div className="row">
          <Badge variant="success">通知已開啟</Badge>
          <span className="muted small">配對成功或收到新訊息時會提醒你</span>
        </div>
      </Surface>
    );
  }

  if (state === "denied") {
    return (
      <Surface elevation="inset">
        <div className="push-card">
          <div>
            <strong>通知已關閉</strong>
            <p className="muted small">配對成功或收到新訊息時無法提醒你</p>
          </div>
        </div>
        <Notice variant="warning">請到瀏覽器的網站設定中重新開啟通知權限。</Notice>
      </Surface>
    );
  }

  return (
    <Surface elevation="inset">
      <div className="push-card">
        <div>
          <strong>開啟通知</strong>
          <p className="muted small">配對成功或收到新訊息時提醒你</p>
        </div>
        {iosHint ? (
          <p className="muted small">在 iPhone 上，請先將 HerLink 加入主畫面（分享 → 加入主畫面），開啟後才支援通知。</p>
        ) : (
          <Button variant="secondary" size="sm" type="button" onClick={() => void enable()} disabled={busy}>
            {busy ? "開啟中…" : "開啟通知"}
          </Button>
        )}
      </div>
      {error ? <Notice variant="danger">{error}</Notice> : null}
    </Surface>
  );
}
