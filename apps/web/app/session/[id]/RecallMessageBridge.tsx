"use client";

import { useEffect } from "react";
import { useParams } from "next/navigation";
import { supabase } from "../../../lib/supabase";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{12}$/i;

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
    let allowNextNativeClick = false;
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

    const showActions = (article: HTMLElement, bubble: HTMLElement, rawId: string) => {
      if (!testerAllowed || recalledIds.has(rawId)) return;
      closeMenu();

      const isMine = article.classList.contains("mine");
      const menu = document.createElement("div");
      menu.dataset.messageActionMenu = "1";
      menu.setAttribute("role", "menu");
      menu.style.cssText = "position:fixed;z-index:2147483001;display:flex;gap:8px;padding:8px;border:1px solid rgba(255,255,255,.14);border-radius:14px;background:rgba(24,18,28,.98);box-shadow:0 12px 36px rgba(0,0,0,.34);";

      const rect = bubble.getBoundingClientRect();
      const top = Math.min(window.innerHeight - 64, Math.max(8, rect.bottom + 6));
      const left = Math.min(window.innerWidth - (isMine ? 210 : 92), Math.max(8, rect.left));
      menu.style.top = `${top}px`;
      menu.style.left = `${left}px`;

      const reply = document.createElement("button");
      reply.type = "button";
      reply.textContent = "回覆";
      reply.style.cssText = "border:0;border-radius:999px;padding:8px 14px;background:#34283d;color:#fff;font-weight:800;";
      reply.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        closeMenu();
        allowNextNativeClick = true;
        bubble.click();
      });
      menu.appendChild(reply);

      if (isMine) {
        const recall = document.createElement("button");
        recall.type = "button";
        recall.textContent = "收回訊息";
        recall.style.cssText = "border:1px solid #ff8ab2;border-radius:999px;padding:8px 14px;background:transparent;color:#ffb1cb;font-weight:800;";
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
      }

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

        if (bubble.dataset.messageActions === "1") return;
        bubble.dataset.messageActions = "1";
        bubble.setAttribute("aria-label", article.classList.contains("mine") ? "訊息操作：回覆或收回" : "訊息操作：回覆");
        bubble.addEventListener("click", (event) => {
          if (allowNextNativeClick) {
            allowNextNativeClick = false;
            return;
          }
          if (!testerAllowed || recalledIds.has(rawId)) return;
          event.preventDefault();
          event.stopImmediatePropagation();
          showActions(article, bubble, rawId);
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
