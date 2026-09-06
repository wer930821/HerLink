"use client";

import AsyncStorage from "@react-native-async-storage/async-storage";
import { useEffect, useState } from "react";

export function SessionSafetyWarning({ sessionId, warning, highRiskAt }: {
  sessionId: string;
  warning: string | null;
  highRiskAt: string;
}) {
  const [visible, setVisible] = useState(false);
  const [storageError, setStorageError] = useState(false);

  useEffect(() => {
    if (!warning) return;
    let active = true;
    const key = `herlink:safety-warning-dismissed:${sessionId}`;
    void (async () => {
      try {
        const previous = await AsyncStorage.getItem(key);
        // Persist on first display as well as dismissal: revisiting is not a new risk.
        if (previous === null || (highRiskAt && highRiskAt > previous)) {
          await AsyncStorage.setItem(key, highRiskAt);
          if (active) setVisible(true);
        }
      } catch {
        if (active) { setVisible(true); setStorageError(true); }
      }
    })();
    return () => { active = false; };
  }, [sessionId, warning, highRiskAt]);

  if (!visible || !warning) return null;
  return <div className="notice safety-notice session-safety-warning" role="status">
    <div>{warning}{storageError ? <small>此瀏覽器無法保存提示紀錄，下次進入可能再次顯示。</small> : null}</div>
    <button type="button" aria-label="關閉安全提示" onClick={() => {
      setVisible(false);
      void AsyncStorage.setItem(`herlink:safety-warning-dismissed:${sessionId}`, highRiskAt).catch(() => setStorageError(true));
    }}>×</button>
  </div>;
}
