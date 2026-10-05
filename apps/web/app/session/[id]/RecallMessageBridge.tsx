"use client";

import { useEffect } from "react";
import { useParams } from "next/navigation";
import { supabase } from "../../../lib/supabase";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{12}$/i;
const LONG_PRESS_MS = 430;
const MOVE_TOLERANCE = 16;

type RecallProjection = { id: string; recalled_at?: string | null; is_mine?: boolean };

export default function RecallMessageBridge() {
  const params = useParams<{ id?: string }>();
  const sessionId = typeof params?.id === "string" ? params.id : "";

  useEffect(() => {
    if (!sessionId || !UUID_RE.test(sessionId)) return;
    let disposed = false;
    let observer: MutationObserver | null = null;
    let allowed = false;
    let menu: HTMLElement | null = null;
    const mine = new Set<string>();
    const recalled = new Set<string>();

    const closeMenu = () => {
      menu?.remove();
      menu = null;
    };

    const openMenu = (messageId: string, bubble: HTMLElement) => {
      if (!allowed || recalled.has(messageId)) return;
      closeMenu();
      const isMine = mine.has(messageId);
      const node = document.createElement("div");
      node.dataset.lineMessageMenu = "1";
      node.style.cssText = "position:fixed;z-index:2147483647;display:flex;overflow:hidden;border-radius:14px;background:#29272b;box-shadow:0 10px 32px rgba(0,0,0,.48);border:1px solid rgba(255,255,255,.12);";
      const rect = bubble.getBoundingClientRect();
      const width = isMine ? 188 : 94;
      const height = 54;
      node.style.left = `${Math.max(8, Math.min(innerWidth - width - 8, isMine ? rect.right - width : rect.left))}px`;
      node.style.top = `${rect.top > height + 12 ? rect.top - height - 7 : Math.min(innerHeight - height - 8, rect.bottom + 7)}px`;

      const button = (text: string) => {
        const b = document.createElement("button");
        b.type = "button";
        b.textContent = text;
        b.style.cssText = "height:54px;min-width:94px;padding:0 14px;border:0;background:transparent;color:#fff;font-size:15px;font-weight:800;";
        return b;
      };

      const reply = button("↩ 回覆");
      reply.onclick = (event) => {
        event.stopPropagation();
        closeMenu();
        bubble.click();
      };
      node.appendChild(reply);

      if (isMine) {
        const recall = button("收回");
        recall.style.borderLeft = "1px solid rgba(255,255,255,.1)";
        recall.onclick = async (event) => {
          event.stopPropagation();
          if (!confirm("確定要收回這則訊息嗎？")) return;
          recall.disabled = true;
          recall.textContent = "收回中…";
          const { error } = await supabase.rpc("recall_random_message", { p_message_id: messageId });
          if (error) {
            recall.disabled = false;
            recall.textContent = "收回";
            alert("目前無法收回訊息，請稍後再試。");
            return;
          }
          recalled.add(messageId);
          closeMenu();
          bubble.replaceChildren(document.createTextNode("此訊息已收回"));
          bubble.style.opacity = ".62";
        };
        node.appendChild(recall);
      }

      document.body.appendChild(node);
      menu = node;
    };

    const bind = () => {
      if (!allowed || disposed) return;
      document.querySelectorAll<HTMLElement>("article.chat-message").forEach((article) => {
        const messageId = article.id.startsWith("chat-msg-") ? article.id.substring(9) : "";
        if (!UUID_RE.test(messageId)) return;
        const bubble = article.querySelector<HTMLElement>(":scope > .chat-bubble");
        if (!bubble || bubble.dataset.lineLongPress === "1") return;
        bubble.dataset.lineLongPress = "1";
        bubble.style.touchAction = "pan-y";
        bubble.style.setProperty("-webkit-touch-callout", "none");
        bubble.style.userSelect = "none";

        let timer = 0;
        let sx = 0;
        let sy = 0;
        let fired = false;
        const clear = () => { if (timer) window.clearTimeout(timer); timer = 0; };
        const start = (x: number, y: number) => {
          sx = x; sy = y; fired = false; clear();
          timer = window.setTimeout(() => {
            timer = 0; fired = true;
            navigator.vibrate?.(20);
            openMenu(messageId, bubble);
          }, LONG_PRESS_MS);
        };

        bubble.addEventListener("pointerdown", (event) => {
          if (event.pointerType === "mouse" && event.button !== 0) return;
          start(event.clientX, event.clientY);
        });
        bubble.addEventListener("pointermove", (event) => {
          if (Math.abs(event.clientX - sx) > MOVE_TOLERANCE || Math.abs(event.clientY - sy) > MOVE_TOLERANCE) clear();
        });
        bubble.addEventListener("pointerup", clear);
        bubble.addEventListener("pointercancel", clear);
        bubble.addEventListener("contextmenu", (event) => {
          event.preventDefault(); clear(); fired = true; openMenu(messageId, bubble);
        });
        bubble.addEventListener("click", (event) => {
          if (!fired) return;
          event.preventDefault(); event.stopImmediatePropagation(); fired = false;
        }, true);
      });
    };

    const bootstrap = async () => {
      const access = await supabase.rpc("can_test_message_recall", { p_session_id: sessionId });
      if (disposed || access.error || access.data !== true) return;
      allowed = true;
      const result = await supabase.rpc("list_random_messages_v2", {
        p_session_id: sessionId,
        p_limit: 100,
        p_before_created_at: null,
        p_before_id: null,
        p_after_created_at: null,
        p_after_id: null,
      });
      if (!result.error && Array.isArray(result.data)) {
        for (const row of result.data as RecallProjection[]) {
          if (row.is_mine) mine.add(row.id);
          if (row.recalled_at) recalled.add(row.id);
        }
      }
      bind();
      observer = new MutationObserver(bind);
      observer.observe(document.body, { childList: true, subtree: true });
    };

    const outside = (event: PointerEvent) => {
      if (menu && !menu.contains(event.target as Node)) closeMenu();
    };
    document.addEventListener("pointerdown", outside);
    void bootstrap();

    return () => {
      disposed = true;
      closeMenu();
      observer?.disconnect();
      document.removeEventListener("pointerdown", outside);
    };
  }, [sessionId]);

  return null;
}
