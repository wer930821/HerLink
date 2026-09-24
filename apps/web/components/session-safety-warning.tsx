"use client";

import { useEffect, useState } from "react";

function readDismissedAt(key: string) {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeDismissedAt(key: string, value: string) {
  try {
    window.localStorage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

export function SessionSafetyWarning({ sessionId, warning, highRiskAt }: {
  sessionId: string;
  warning: string | null;
  highRiskAt: string;
}) {
  const [visible, setVisible] = useState(false);
  const [storageError, setStorageError] = useState(false);

  useEffect(() => {
    if (!warning) return;
    const key = `herlink:safety-warning-dismissed:${sessionId}`;
    const previous = readDismissedAt(key);

    if (previous === null || (highRiskAt && highRiskAt > previous)) {
      if (!writeDismissedAt(key, highRiskAt)) {
        setStorageError(true);
      }
      setVisible(true);
    }
  }, [sessionId, warning, highRiskAt]);

  if (!visible || !warning) return null;

  return (
    <div className="notice safety-notice session-safety-warning" role="status">
      <div>
        {warning}
        {storageError ? <small>此瀏覽器無法保存提示紀錄，下次進入可能再次顯示。</small> : null}
      </div>
      <button
        type="button"
        aria-label="關閉安全提示"
        onClick={() => {
          setVisible(false);
          if (!writeDismissedAt(`herlink:safety-warning-dismissed:${sessionId}`, highRiskAt)) {
            setStorageError(true);
          }
        }}
      >
        ×
      </button>
    </div>
  );
}
