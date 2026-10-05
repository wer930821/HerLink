"use client";

import { useEffect } from "react";
import { useParams } from "next/navigation";
import { supabase } from "../../../lib/supabase";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{12}$/i;
const LONG_PRESS_MS = 500;
const MOVE_TOLERANCE = 12;

type RecallProjection = { id: string; recalled_at?: string | null };

export default function RecallMessageBridge() {
  const params = useParams<{ id?: string }>();
  const sessionId = typeof params?.id === "string" ? params.id : "";

  useEffect(() => {
    if (!sessionId || !UUID_RE.test(sessionId)) return;
    let disposed = false;
    let observer: MutationObserver | null = null;
    let retryTimer: number | null = null;
    let recallStateLoaded = false;
    let testerAllowed = false;
    let testerChecked = false;
    let openMenu: HTMLElement | null = null;
    const recalledIds = new Set<string>();

    const closeMenu = () => {
      openMenu?.remove();
      openMenu = null;
    };

    const detectTester = async () => {
      if (testerChecked) return testerAllowed;
      const { data, error } = await supabase.rpc("can_test_message_recall", { p_session_id: sessionId });
      if (disposed) return false;
      if (error) {
        testerChecked = false;
        testerAllowed = false;
        return false;
      }
      testerChecked = true;
      testerAllowed = data === true;
      return testerAllowed;
    };

    const showRecallMenu = (article: HTMLElement, bubble: HTMLElement, rawId: string) => {
      if (!testerAllowed || recalledIds.has(rawId) || !article.classList.contains("mine")) return;
      closeMenu();

      const menu = document.createElement("div");
      menu.dataset.messageActionMenu = "1";
      menu.setAttribute("role", "menu");
      menu.style.cssText = "position:fixed;z-index:2147483001;display:flex;align-items:center;padding:7px;border:1px solid rgba(255,255,255,.12);border-radius:14px;background:rgba(34,32,35,.98);box-shadow:0 12px 36px rgba(0,0,0,.42);";

      const rect = bubble.getBoundingClientRect();
      const menuWidth = 126;
      const top = rect.top > 68 ? rect.top - 58 : Math.min(window.innerHeight - 58, rect.bottom + 8);
      const left = Math.min(window.innerWidth - menuWidth - 8, Math.max(8, rect.right - menuWidth));
      menu.style.top = `${top}px`;
      menu.style.left = `${left}px`;

      const recall = document.createElement("button");
      recall.type = "button";
      recall.textContent = "收回訊息";
      recall.style.cssText = "width:112px;border:0;border-radius:10px;padding:11px 12px;background:transparent;color:#fff;font-size:15px;font-weight:800;";
      recall.addEventListener("click", async (event) => {
        event.preventDefault();
        event.stopPropagation();
        if (recall.disabled || !window.confirm("確定要收回這則訊息嗎？")) return;
        recall.disabled = true;
        recall.textContent = "收回中…";
        const { error } = await supabase.rpc("recall_random_message", { p_message_id: rawId });
        if (error) {
          recall.disabled = false;
          recall.textContent = "收回訊息";
          window.alert("目前無法收回訊息，請稍後再試。");
          return;
        }
        recalledIds.add(rawId);
        closeMenu();
        enhance();
        window.dispatchEvent(new Event("focus"));
      });
      menu.appendChild(recall);
      document.body.appendChild(menu);
      openMenu = menu;
    };

    const enhance = () => {
      if (disposed || !testerAllowed) return;
      document.querySelectorAll<HTMLElement>("article.chat-message").forEach((article) => {
        const rawId = article.id.startsWith("chat-msg-") ? article.id.slice(9) : "";
        if (!UUID_RE.test(rawId)) return;
        const bubble = article.querySelector<HTMLElement>(".chat-bubble");
        if (!bubble) return;

        if (recalledIds.has(rawId)) {
          if (bubble.dataset.recalled !== "1") {
            bubble.dataset.recalled = "1";
            bubble.removeAttribute("role");
            bubble.removeAttribute("tabindex");
            bubble.setAttribute("aria-label", "此訊息已收回");
            bubble.style.opacity = ".62";
            bubble.replaceChildren(document.createTextNode("此訊息已收回"));
          }
          return;
        }

        if (!article.classList.contains("mine") || bubble.dataset.recallLongPress === "1") return;
        bubble.dataset.recallLongPress = "1";
        bubble.style.touchAction = "pan-y";
        bubble.setAttribute("aria-label", "長按可收回訊息；點一下可回覆");

        let timer: number | null = null;
        let startX = 0;
        let startY = 0;
        let longPressed = false;

        const clearTimer = () => {
          if (timer !== null) window.clearTimeout(timer);
          timer = null;
        };

        bubble.addEventListener("pointerdown", (event) => {
          if (event.pointerType === "mouse" && event.button !== 0) return;
          startX = event.clientX;
          startY = event.clientY;
          longPressed = false;
          clearTimer();
          timer = window.setTimeout(() => {
            timer = null;
            longPressed = true;
            if (navigator.vibrate) navigator.vibrate(25);
            showRecallMenu(article, bubble, rawId);
          }, LONG_PRESS_MS);
        });

        bubble.addEventListener("pointermove", (event) => {
          if (Math.abs(event.clientX - startX) > MOVE_TOLERANCE || Math.abs(event.clientY - startY) > MOVE_TOLERANCE) clearTimer();
        });
        bubble.addEventListener("pointerup", clearTimer);
        bubble.addEventListener("pointercancel", clearTimer);
        bubble.addEventListener("pointerleave", clearTimer);
        bubble.addEventListener("contextmenu", (event) => {
          event.preventDefault();
          clearTimer();
          longPressed = true;
          showRecallMenu(article, bubble, rawId);
        });
        bubble.addEventListener("click", (event) => {
          if (!longPressed) return;
          event.preventDefault();
          event.stopImmediatePropagation();
          longPressed = false;
        }, true);
      });
    };

    const syncRecallState = async () => {
      if (recallStateLoaded || !testerAllowed) return;
      recallStateLoaded = true;
      const { data, error } = await supabase.rpc("list_random_messages_v2", {
        p_session_id: sessionId,
        p_limit: 100,
        p_before_created_at: null,
        p_before_id: null,
        p_after_created_at: null,
        p_after_id: null,
      });
      if (disposed || error || !Array.isArray(data)) {
        recallStateLoaded = false;
        return;
      }
      recalledIds.clear();
      for (const row of data as RecallProjection[]) if (row.recalled_at) recalledIds.add(row.id);
      enhance();
    };

    const tick = async () => {
      if (!testerChecked) await detectTester();
      enhance();
      void syncRecallState();
    };

    const closeOnOutside = (event: PointerEvent) => {
      if (openMenu && !openMenu.contains(event.target as Node)) closeMenu();
    };

    document.addEventListener("pointerdown", closeOnOutside);
    void tick();
    retryTimer = window.setInterval(() => void tick(), 500);
    observer = new MutationObserver(() => void tick());
    observer.observe(document.body, { childList: true, subtree: true });

    return () => {
      disposed = true;
      closeMenu();
      document.removeEventListener("pointerdown", closeOnOutside);
      observer?.disconnect();
      if (retryTimer !== null) window.clearInterval(retryTimer);
    };
  }, [sessionId]);

  return null;
}
