"use client";

import { useEffect } from "react";
import { useParams } from "next/navigation";
import { supabase } from "../../../lib/supabase";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{12}$/i;
const LONG_PRESS_MS = 420;
const MOVE_TOLERANCE = 18;

type RecallProjection = { id: string; recalled_at?: string | null; is_mine?: boolean };

export default function RecallMessageBridge() {
  const params = useParams<{ id?: string }>();
  const sessionId = typeof params?.id === "string" ? params.id : "";

  useEffect(() => {
    if (!sessionId || !UUID_RE.test(sessionId)) return;
    let disposed = false;
    let observer: MutationObserver | null = null;
    let testerAllowed = false;
    let openMenu: HTMLElement | null = null;
    const recalledIds = new Set<string>();
    const mineIds = new Set<string>();

    const closeMenu = () => {
      openMenu?.remove();
      openMenu = null;
    };

    const loadAccessAndMessages = async () => {
      const { data: allowed, error: allowedError } = await supabase.rpc("can_test_message_recall", { p_session_id: sessionId });
      if (disposed || allowedError || allowed !== true) return false;
      testerAllowed = true;
      const { data, error } = await supabase.rpc("list_random_messages_v2", {
        p_session_id: sessionId,
        p_limit: 100,
        p_before_created_at: null,
        p_before_id: null,
        p_after_created_at: null,
        p_after_id: null,
      });
      if (disposed || error || !Array.isArray(data)) return true;
      recalledIds.clear();
      mineIds.clear();
      for (const row of data as RecallProjection[]) {
        if (row.recalled_at) recalledIds.add(row.id);
        if (row.is_mine) mineIds.add(row.id);
      }
      return true;
    };

    const renderMenu = (bubble: HTMLElement, rawId: string) => {
      if (!testerAllowed || recalledIds.has(rawId)) return;
      closeMenu();
      const isMine = mineIds.has(rawId);
      const menu = document.createElement("div");
      menu.dataset.messageActionMenu = "1";
      menu.setAttribute("role", "menu");
      menu.style.cssText = "position:fixed;z-index:2147483646;display:flex;overflow:hidden;border:1px solid rgba(255,255,255,.12);border-radius:15px;background:#252326;box-shadow:0 12px 34px rgba(0,0,0,.5);user-select:none;-webkit-user-select:none;";

      const rect = bubble.getBoundingClientRect();
      const menuWidth = isMine ? 190 : 92;
      const menuHeight = 56;
      const top = rect.top >= menuHeight + 12 ? rect.top - menuHeight - 7 : Math.min(window.innerHeight - menuHeight - 8, rect.bottom + 7);
      const left = isMine ? Math.min(window.innerWidth - menuWidth - 8, Math.max(8, rect.right - menuWidth)) : Math.min(window.innerWidth - menuWidth - 8, Math.max(8, rect.left));
      menu.style.top = `${top}px`;
      menu.style.left = `${left}px`;

      const makeButton = (label: string) => {
        const button = document.createElement("button");
        button.type = "button";
        button.textContent = label;
        button.style.cssText = "min-width:92px;height:56px;border:0;background:transparent;color:white;font-size:15px;font-weight:800;padding:0 13px;";
        return button;
      };

      const reply = makeButton("↩ 回覆");
      reply.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        closeMenu();
        bubble.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: window }));
      });
      menu.appendChild(reply);

      if (isMine) {
        const recall = makeButton("收回");
        recall.style.borderLeft = "1px solid rgba(255,255,255,.1)";
        recall.addEventListener("click", async (event) => {
          event.preventDefault();
          event.stopPropagation();
          if (recall.disabled || !window.confirm("確定要收回這則訊息嗎？")) return;
          recall.disabled = true;
          recall.textContent = "收回中…";
          const { error } = await supabase.rpc("recall_random_message", { p_message_id: rawId });
          if (error) {
            recall.disabled = false;
            recall.textContent = "收回";
            window.alert("目前無法收回訊息，請稍後再試。");
            return;
          }
          recalledIds.add(rawId);
          closeMenu();
          bubble.replaceChildren(document.createTextNode("此訊息已收回"));
          bubble.style.opacity = ".62";
          bubble.removeAttribute("role");
          bubble.removeAttribute("tabindex");
          bubble.setAttribute("aria-label", "此訊息已收回");
        });
        menu.appendChild(recall);
      }

      document.body.appendChild(menu);
      openMenu = menu;
    };

    const bind = () => {
      if (!testerAllowed || disposed) return;
      document.querySelectorAll<HTMLElement>("article.chat-message[id^='chat-msg-']").forEach((article) => {
        const rawId = article.id.slice("chat-msg-".length);
        if (!UUID_RE.test(rawId)) return;
        const bubble = article.querySelector<HTMLElement>(".chat-bubble");
        if (!bubble || bubble.dataset.lineActions === "1") return;
        bubble.dataset.lineActions = "1";
        bubble.style.touchAction = "pan-y";
        bubble.style.setProperty("-webkit-touch-callout", "none");
        bubble.style.userSelect = "none";
        bubble.setAttribute("aria-label", "長按開啟訊息選單");

        let timer: number | null = null;
        let startX = 0;
        let startY = 0;
        let consumed = false;

        const clear = () => {
          if (timer !== null) window.clearTimeout(timer);
          timer = null;
        };

        const start = (x: number, y: number) => {
          startX = x;
          startY = y;
          consumed = false;
          clear();
          timer = window.setTimeout(() => {
            timer = null;
            consumed = true;
            if (navigator.vibrate) navigator.vibrate(20);
            renderMenu(bubble, rawId);
          }, LONG_PRESS_MS);
        };

        bubble.addEventListener("touchstart", (event) => {
          const touch = event.touches[0];
          if (touch) start(touch.clientX, touch.clientY);
        }, { passive: true });
        bubble.addEventListener("touchmove", (event) => {
          const touch = event.touches[0];
          if (touch && (Math.abs(touch.clientX - startX) > MOVE_TOLERANCE || Math.abs(touch.clientY - startY) > MOVE_TOLERANCE)) clear();
        }, { passive: true });
        bubble.addEventListener("touchend", clear, { passive: true });
        bubble.addEventListener("touchcancel", clear, { passive: true });
        bubble.addEventListener("pointerdown", (event) => {
          if (event.pointerType === "touch") return;
          if (event.pointerType === "mouse" && event.button !== 0) return;
          start(event.clientX, event.clientY);
        });
        bubble.addEventListener("pointermove", (event) => {
          if (event.pointerType !== "touch" && (Math.abs(event.clientX - startX) > MOVE_TOLERANCE || Math.abs(event.clientY - startY) > MOVE_TOLERANCE)) clear();
        });
        bubble.addEventListener("pointerup", clear);
        bubble.addEventListener("pointercancel", clear);
        bubble.addEventListener("contextmenu", (event) => {
          event.preventDefault();
          clear();
          consumed = true;
          renderMenu(bubble, rawId);
        });
        bubble.addEventListener("click", (event) => {
          if (!consumed) return;
          event.preventDefault();
          event.stopImmediatePropagation();
          consumed = false;
        }, true);
      });
    };

    const outside = (event: Event) => {
      if (openMenu && !openMenu.contains(event.target as Node)) closeMenu();
    };

    document.addEventListener("pointerdown", outside);
    void loadAccessAndMessages().then(() => bind());
    observer = new MutationObserver(() => bind());
    observer.observe(document.body, { childList: true, subtree: true });

    return () => {
      disposed = true;
      closeMenu();
      document.removeEventListener("pointerdown", outside);
      observer?.disconnect();
    };
  }, [sessionId]);

  return null;
}
