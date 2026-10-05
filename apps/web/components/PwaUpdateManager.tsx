"use client";

import { useEffect } from "react";

const RELOAD_GUARD = "herlink-sw-reload-v3";

export function PwaUpdateManager() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;

    let disposed = false;

    const reloadOnce = () => {
      if (sessionStorage.getItem(RELOAD_GUARD) === "1") return;
      sessionStorage.setItem(RELOAD_GUARD, "1");
      window.location.reload();
    };

    const onMessage = (event: MessageEvent) => {
      if (event.data?.type === "herlink-sw-activated") reloadOnce();
    };

    const onControllerChange = () => reloadOnce();

    navigator.serviceWorker.addEventListener("message", onMessage);
    navigator.serviceWorker.addEventListener("controllerchange", onControllerChange);

    void navigator.serviceWorker
      .register("/sw.js", { updateViaCache: "none" })
      .then(async (registration) => {
        if (disposed) return;
        await registration.update();
        if (registration.waiting) registration.waiting.postMessage({ type: "herlink-skip-waiting" });
      })
      .catch(() => undefined);

    return () => {
      disposed = true;
      navigator.serviceWorker.removeEventListener("message", onMessage);
      navigator.serviceWorker.removeEventListener("controllerchange", onControllerChange);
    };
  }, []);

  return null;
}
