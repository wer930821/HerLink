"use client";

import dynamic from "next/dynamic";
import { useEffect, useRef, useState, type MouseEvent, type PointerEvent } from "react";
import { supabase } from "../../../lib/supabase";

const LONELY_PENGUIN_ID = "671fac06-8eeb-4b95-830a-8d4e141fda9a";
const LONG_PRESS_MS = 420;
const RECALL_HINT_MS = 1000;

const RandomSessionClient = dynamic(() => import("./RandomSessionClient"), {
  ssr: false,
  loading: () => <main className="chat-page"><section className="chat-shell"><div className="notice">聊天室載入中…</div></section></main>,
});

type ActionTarget = { bubble: HTMLElement; article: HTMLElement; messageId: string; mine: boolean };

function asElement(target: EventTarget | null) { return target instanceof Element ? target : null; }
function isActionMenuTarget(target: EventTarget | null) { return Boolean(asElement(target)?.closest('[data-line-message-menu="1"]')); }
function getActionTarget(target: EventTarget | null): ActionTarget | null {
  const element = asElement(target);
  const bubble = element?.closest<HTMLElement>(".chat-bubble") ?? null;
  const article = bubble?.closest<HTMLElement>("article.chat-message") ?? null;
  if (!bubble || !article || !article.id.startsWith("chat-msg-")) return null;
  return { bubble, article, messageId: article.id.slice("chat-msg-".length), mine: article.classList.contains("mine") };
}

export default function RandomSessionPage() {
  const [allowed, setAllowed] = useState(false);
  const [menu, setMenu] = useState<(ActionTarget & { left: number; top: number }) | null>(null);
  const [hiddenMessageIds, setHiddenMessageIds] = useState<Set<string>>(() => new Set());
  const timerRef = useRef<number | null>(null);
  const startRef = useRef({ x: 0, y: 0 });
  const activeRef = useRef<ActionTarget | null>(null);
  const bypassClickRef = useRef(false);

  useEffect(() => {
    let alive = true;
    void (async () => { const result = await supabase.auth.getUser(); if (alive) setAllowed(result.data.user?.id === LONELY_PENGUIN_ID); })();
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    if (!allowed) return;
    const style = document.createElement("style");
    style.dataset.lonelyPenguinMessageActions = "1";
    style.textContent = `
      article.chat-message .chat-bubble, article.chat-message .chat-bubble * { -webkit-user-select: none !important; user-select: none !important; -webkit-touch-callout: none !important; }
      article.chat-message[data-recall-preview="1"] .chat-bubble { opacity: .72; transition: opacity .28s ease, transform .28s ease; }
      article.chat-message[data-recall-preview="1"] .chat-message-content { font-size: 13px !important; font-style: italic; opacity: .82; }
      article.chat-message[data-recall-fading="1"] .chat-bubble { opacity: 0; transform: scale(.96); }
    `;
    document.head.appendChild(style);

    const hideRecalledMessages = () => {
      for (const article of Array.from(document.querySelectorAll<HTMLElement>("article.chat-message"))) {
        if (article.dataset.recallPreview === "1") continue;
        const messageContent = article.querySelector<HTMLElement>(".chat-message-content");
        if (!messageContent) continue;
        const text = messageContent.textContent?.trim() ?? "";
        if (!text || text === "此訊息已收回" || text === "已收回") {
          article.style.setProperty("display", "none", "important");
        }
      }
    };

    hideRecalledMessages();
    const observer = new MutationObserver(hideRecalledMessages);
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });

    return () => {
      observer.disconnect();
      style.remove();
    };
  }, [allowed]);

  useEffect(() => {
    if (!allowed || hiddenMessageIds.size === 0) return;
    for (const messageId of hiddenMessageIds) {
      const article = document.getElementById(`chat-msg-${messageId}`);
      if (article) article.style.setProperty("display", "none", "important");
    }
  }, [allowed, hiddenMessageIds]);

  const clearSelection = () => { const selection = window.getSelection?.(); if (selection && selection.rangeCount > 0) selection.removeAllRanges(); };
  const clearPress = () => { if (timerRef.current !== null) window.clearTimeout(timerRef.current); timerRef.current = null; activeRef.current = null; };
  const openMenu = (target: ActionTarget) => {
    if (hiddenMessageIds.has(target.messageId)) return;
    const messageContent = target.bubble.querySelector<HTMLElement>(".chat-message-content");
    const visibleText = messageContent?.textContent?.trim() ?? target.bubble.textContent?.trim() ?? "";
    if (!visibleText || visibleText === "此訊息已收回" || visibleText === "已收回") return;
    clearSelection();
    const rect = target.bubble.getBoundingClientRect();
    const width = target.mine ? 188 : 94;
    const height = 54;
    setMenu({ ...target, left: Math.max(8, Math.min(window.innerWidth - width - 8, target.mine ? rect.right - width : rect.left)), top: rect.top > height + 12 ? rect.top - height - 7 : Math.min(window.innerHeight - height - 8, rect.bottom + 7) });
    navigator.vibrate?.(20);
  };

  const onPointerDownCapture = (event: PointerEvent<HTMLDivElement>) => {
    if (!allowed || isActionMenuTarget(event.target)) return;
    const target = getActionTarget(event.target);
    if (!target) { setMenu(null); return; }
    event.preventDefault(); clearSelection(); clearPress();
    startRef.current = { x: event.clientX, y: event.clientY }; activeRef.current = target;
    timerRef.current = window.setTimeout(() => { timerRef.current = null; if (activeRef.current) openMenu(activeRef.current); }, LONG_PRESS_MS);
  };
  const onPointerMoveCapture = (event: PointerEvent<HTMLDivElement>) => { if (!allowed || isActionMenuTarget(event.target) || timerRef.current === null) return; if (Math.abs(event.clientX - startRef.current.x) > 18 || Math.abs(event.clientY - startRef.current.y) > 18) clearPress(); };
  const onClickCapture = (event: MouseEvent<HTMLDivElement>) => { if (!allowed || bypassClickRef.current || isActionMenuTarget(event.target) || !getActionTarget(event.target)) return; event.preventDefault(); event.stopPropagation(); };
  const reply = () => { if (!menu) return; const bubble = menu.bubble; setMenu(null); bypassClickRef.current = true; bubble.click(); queueMicrotask(() => { bypassClickRef.current = false; }); };

  const recall = async () => {
    if (!menu?.mine) return;
    const target = menu;
    setMenu(null);
    const result = await supabase.rpc("recall_random_message", { p_message_id: target.messageId });
    if (result.error) { window.alert(`目前無法收回訊息：${result.error.message || "請稍後再試"}`); return; }

    const messageContent = target.article.querySelector<HTMLElement>(".chat-message-content");
    target.article.dataset.recallPreview = "1";
    if (messageContent) messageContent.textContent = "已收回";

    window.setTimeout(() => {
      target.article.dataset.recallFading = "1";
      window.setTimeout(() => {
        target.article.style.setProperty("display", "none", "important");
        delete target.article.dataset.recallPreview;
        delete target.article.dataset.recallFading;
        setHiddenMessageIds((current) => {
          const next = new Set(current);
          next.add(target.messageId);
          return next;
        });
      }, 280);
    }, RECALL_HINT_MS);
  };

  return (
    <div style={{ display: "contents" }} onPointerDownCapture={onPointerDownCapture} onPointerMoveCapture={onPointerMoveCapture} onPointerUpCapture={(event) => { if (!isActionMenuTarget(event.target)) clearPress(); }} onPointerCancelCapture={clearPress} onClickCapture={onClickCapture} onContextMenu={(event) => { if (!allowed || isActionMenuTarget(event.target)) return; const target = getActionTarget(event.target); if (!target) return; event.preventDefault(); clearSelection(); openMenu(target); }}>
      <RandomSessionClient />
      {menu ? <div data-line-message-menu="1" style={{ position: "fixed", left: menu.left, top: menu.top, zIndex: 2147483647, display: "flex", overflow: "hidden", borderRadius: 14, background: "#29272b", boxShadow: "0 10px 32px rgba(0,0,0,.5)", border: "1px solid rgba(255,255,255,.12)", WebkitUserSelect: "none", userSelect: "none", WebkitTouchCallout: "none", pointerEvents: "auto" }}>
        <button type="button" onClick={reply} style={{ height: 54, minWidth: 94, padding: "0 14px", border: 0, background: "transparent", color: "#fff", fontSize: 15, fontWeight: 800, cursor: "pointer", touchAction: "manipulation" }}>↩ 回覆</button>
        {menu.mine ? <button type="button" onClick={() => void recall()} style={{ height: 54, minWidth: 94, padding: "0 14px", border: 0, borderLeft: "1px solid rgba(255,255,255,.1)", background: "transparent", color: "#fff", fontSize: 15, fontWeight: 800, cursor: "pointer", touchAction: "manipulation" }}>收回</button> : null}
      </div> : null}
    </div>
  );
}
