"use client";

import { useEffect } from "react";
import { useParams } from "next/navigation";
import { supabase } from "../../../lib/supabase";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{12}$/i;
const LONELY_PENGUIN_ID = "e2817803-1304-4ef0-b0b8-66f473b12886";
const LONG_PRESS_MS = 420;
const MOVE_TOLERANCE = 18;

function getMessageTarget(target: EventTarget | null) {
  const element = target instanceof Element ? target : null;
  const bubble = element?.closest<HTMLElement>(".chat-bubble") ?? null;
  const article = bubble?.closest<HTMLElement>("article.chat-message") ?? null;
  if (!bubble || !article || !article.id.startsWith("chat-msg-")) return null;
  const messageId = article.id.slice(9);
  if (!UUID_RE.test(messageId)) return null;
  return { bubble, article, messageId };
}

export default function RecallMessageBridge() {
  const params = useParams<{ id?: string }>();
  const sessionId = typeof params?.id === "string" ? params.id : "";

  useEffect(() => {
    if (!sessionId || !UUID_RE.test(sessionId)) return;
    let disposed = false;
    let allowed = false;
    let menu: HTMLElement | null = null;
    let timer = 0;
    let startX = 0;
    let startY = 0;
    let active: ReturnType<typeof getMessageTarget> = null;
    let suppressNextClick = false;

    const clearTimer = () => { if (timer) window.clearTimeout(timer); timer = 0; };
    const closeMenu = () => { menu?.remove(); menu = null; };

    const showMenu = (target: NonNullable<ReturnType<typeof getMessageTarget>>) => {
      if (!allowed || disposed) return;
      closeMenu();
      const { article, bubble, messageId } = target;
      const isMine = article.classList.contains("mine");
      if (bubble.textContent?.trim() === "此訊息已收回") return;

      const node = document.createElement("div");
      node.dataset.lineMessageMenu = "1";
      node.style.cssText = "position:fixed;z-index:2147483647;display:flex;overflow:hidden;border-radius:14px;background:#29272b;box-shadow:0 10px 32px rgba(0,0,0,.5);border:1px solid rgba(255,255,255,.12);touch-action:manipulation;";
      const rect = bubble.getBoundingClientRect();
      const width = isMine ? 188 : 94;
      const height = 54;
      node.style.left = `${Math.max(8, Math.min(window.innerWidth - width - 8, isMine ? rect.right - width : rect.left))}px`;
      node.style.top = `${rect.top > height + 12 ? rect.top - height - 7 : Math.min(window.innerHeight - height - 8, rect.bottom + 7)}px`;

      const makeButton = (label: string) => {
        const button = document.createElement("button");
        button.type = "button";
        button.textContent = label;
        button.style.cssText = "height:54px;min-width:94px;padding:0 14px;border:0;background:transparent;color:#fff;font-size:15px;font-weight:800;touch-action:manipulation;";
        return button;
      };

      const reply = makeButton("↩ 回覆");
      reply.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        closeMenu();
        allowed = false;
        bubble.click();
        queueMicrotask(() => { allowed = true; });
      });
      node.appendChild(reply);

      if (isMine) {
        const recall = makeButton("收回");
        recall.style.borderLeft = "1px solid rgba(255,255,255,.1)";
        recall.addEventListener("click", async (event) => {
          event.preventDefault();
          event.stopPropagation();
          if (recall.disabled || !window.confirm("確定要收回這則訊息嗎？")) return;
          recall.disabled = true;
          recall.textContent = "收回中…";
          const { error } = await supabase.rpc("recall_random_message", { p_message_id: messageId });
          if (error) {
            recall.disabled = false;
            recall.textContent = "收回";
            window.alert(`目前無法收回訊息：${error.message || "請稍後再試"}`);
            return;
          }
          closeMenu();
          bubble.replaceChildren(document.createTextNode("此訊息已收回"));
          bubble.style.opacity = ".62";
          bubble.removeAttribute("role");
          bubble.removeAttribute("tabindex");
        });
        node.appendChild(recall);
      }
      document.body.appendChild(node);
      menu = node;
    };

    const begin = (x: number, y: number, target: ReturnType<typeof getMessageTarget>) => {
      if (!allowed || !target) return;
      clearTimer();
      active = target;
      startX = x;
      startY = y;
      timer = window.setTimeout(() => {
        timer = 0;
        if (!active) return;
        suppressNextClick = true;
        navigator.vibrate?.(20);
        showMenu(active);
      }, LONG_PRESS_MS);
    };

    const onPointerDown = (event: PointerEvent) => {
      if (menu && !menu.contains(event.target as Node)) closeMenu();
      if (event.pointerType === "touch") return;
      if (event.pointerType === "mouse" && event.button !== 0) return;
      begin(event.clientX, event.clientY, getMessageTarget(event.target));
    };
    const onPointerMove = (event: PointerEvent) => {
      if (Math.abs(event.clientX - startX) > MOVE_TOLERANCE || Math.abs(event.clientY - startY) > MOVE_TOLERANCE) clearTimer();
    };
    const onTouchStart = (event: TouchEvent) => {
      if (menu && !menu.contains(event.target as Node)) closeMenu();
      const touch = event.touches[0];
      if (touch) begin(touch.clientX, touch.clientY, getMessageTarget(event.target));
    };
    const onTouchMove = (event: TouchEvent) => {
      const touch = event.touches[0];
      if (touch && (Math.abs(touch.clientX - startX) > MOVE_TOLERANCE || Math.abs(touch.clientY - startY) > MOVE_TOLERANCE)) clearTimer();
    };
    const onEnd = () => { clearTimer(); active = null; };
    const onContextMenu = (event: MouseEvent) => {
      const target = getMessageTarget(event.target);
      if (!allowed || !target) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      suppressNextClick = true;
      showMenu(target);
    };
    const onClick = (event: MouseEvent) => {
      if (!allowed || !getMessageTarget(event.target)) return;
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      suppressNextClick = false;
    };

    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("pointermove", onPointerMove, true);
    document.addEventListener("pointerup", onEnd, true);
    document.addEventListener("pointercancel", onEnd, true);
    document.addEventListener("touchstart", onTouchStart, { capture: true, passive: true });
    document.addEventListener("touchmove", onTouchMove, { capture: true, passive: true });
    document.addEventListener("touchend", onEnd, true);
    document.addEventListener("touchcancel", onEnd, true);
    document.addEventListener("contextmenu", onContextMenu, true);
    document.addEventListener("click", onClick, true);

    const checkAccess = async () => {
      const { data: authData } = await supabase.auth.getUser();
      if (disposed) return;
      allowed = authData.user?.id === LONELY_PENGUIN_ID;
      if (!allowed) return;
      const { data, error } = await supabase.rpc("can_test_message_recall", { p_session_id: sessionId });
      if (!disposed && (error || data !== true)) {
        console.warn("[message-actions] recall capability check failed", error?.message ?? "not allowed for session");
      }
    };
    void checkAccess();

    return () => {
      disposed = true;
      clearTimer();
      closeMenu();
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("pointermove", onPointerMove, true);
      document.removeEventListener("pointerup", onEnd, true);
      document.removeEventListener("pointercancel", onEnd, true);
      document.removeEventListener("touchstart", onTouchStart, true);
      document.removeEventListener("touchmove", onTouchMove, true);
      document.removeEventListener("touchend", onEnd, true);
      document.removeEventListener("touchcancel", onEnd, true);
      document.removeEventListener("contextmenu", onContextMenu, true);
      document.removeEventListener("click", onClick, true);
    };
  }, [sessionId]);

  return null;
}
