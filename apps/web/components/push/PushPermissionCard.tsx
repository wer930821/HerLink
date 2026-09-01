"use client";

import { useCallback, useEffect, useState } from "react";
import { Badge, Button, Notice, Surface } from "../ui";
import {
  getNotificationPermission,
  getPushDiagnostics,
  isIosSafariWithoutStandalone,
  isPushSupported,
  listenForSubscriptionChanges,
  recreatePushSubscription,
  requestPushPermission,
  sendDirectPushTest,
  syncPushSubscription,
  type PushDiagnostics,
  type PushPermissionState,
} from "../../lib/web-push";

export function PushPermissionCard({ forceDebug = false }: { forceDebug?: boolean }) {
  const [state, setState] = useState<PushPermissionState>("default");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [debug, setDebug] = useState(forceDebug);
  const [diagnostics, setDiagnostics] = useState<PushDiagnostics | null>(null);
  const [testResult, setTestResult] = useState<string | null>(null);
  const [iosHint] = useState(() => isIosSafariWithoutStandalone());

  useEffect(() => {
    setDebug(forceDebug || new URLSearchParams(window.location.search).get("debug") === "1");
    if (!isPushSupported()) {
      setState("unsupported");
      return;
    }

    setState(getNotificationPermission());
    void listenForSubscriptionChanges();

    if (Notification.permission === "granted") {
      void syncPushSubscription();
    }
  }, [forceDebug]);

  const refreshDiagnostics = useCallback(async () => {
    setDiagnostics(await getPushDiagnostics().catch(() => null));
  }, []);

  useEffect(() => {
    if (debug) void refreshDiagnostics();
  }, [debug, refreshDiagnostics]);

  useEffect(() => {
    const receive = (event: MessageEvent) => {
      if (event.data?.type === "herlink-push-diagnostic") {
        setTestResult(`${event.data.event}${event.data.detail ? `: ${event.data.detail}` : ""}`);
      }
    };
    navigator.serviceWorker?.addEventListener("message", receive);
    return () => navigator.serviceWorker?.removeEventListener("message", receive);
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

  const recreate = useCallback(async () => {
    setBusy(true);
    setTestResult(null);
    try {
      setTestResult((await recreatePushSubscription()) ? "訂閱已重新建立。" : "無法重新建立訂閱。" );
    } finally {
      await refreshDiagnostics();
      setBusy(false);
    }
  }, [refreshDiagnostics]);

  const directTest = useCallback(async () => {
    setBusy(true);
    try {
      const { data, error: testError } = await sendDirectPushTest();
      const detail = testError as { name?: string; message?: string; status?: number; code?: string; context?: { status?: number } } | null;
      setTestResult(testError
        ? JSON.stringify({ function: "send-push", name: detail?.name ?? "Error", message: detail?.message ?? String(testError), status: detail?.status ?? detail?.context?.status ?? null, code: detail?.code ?? null })
        : JSON.stringify(data));
    } finally {
      await refreshDiagnostics();
      setBusy(false);
    }
  }, [refreshDiagnostics]);

  const debugPanel = debug ? (
    <details open className="push-card">
      <summary>Push Diagnostics</summary>
      <pre className="muted small">{diagnostics ? JSON.stringify(diagnostics, null, 2) : "讀取中…"}</pre>
      <div className="row">
        <Button variant="secondary" size="sm" type="button" onClick={() => void refreshDiagnostics()} disabled={busy}>重新讀取</Button>
        <Button variant="secondary" size="sm" type="button" onClick={() => void recreate()} disabled={busy}>重新建立通知訂閱</Button>
        <Button variant="secondary" size="sm" type="button" onClick={() => void directTest()} disabled={busy}>發送測試通知</Button>
      </div>
      {testResult ? <p className="muted small">{testResult}</p> : null}
    </details>
  ) : null;

  if (state === "unsupported" && !debug) {
    return null;
  }

  if (state === "unsupported") {
    return <Surface elevation="inset">{debugPanel}</Surface>;
  }

  if (state === "granted") {
    return (
      <Surface elevation="inset">
        <div className="row">
          <Badge variant="success">通知已開啟</Badge>
          <span className="muted small">配對成功或收到新訊息時會提醒你</span>
        </div>
        {debugPanel}
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
        {debugPanel}
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
      {debugPanel}
    </Surface>
  );
}
