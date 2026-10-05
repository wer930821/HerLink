"use client";

import { useEffect } from "react";
import { useParams } from "next/navigation";
import { supabase } from "../../../lib/supabase";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export default function RecallMessageBridge() {
  const params = useParams<{ id?: string }>();
  const sessionId = typeof params?.id === "string" ? params.id : "";

  useEffect(() => {
    if (!sessionId || !UUID_RE.test(sessionId)) return;
    let disposed = false;
    let refreshing = false;

    const refresh = () => {
      if (disposed || refreshing) return;
      refreshing = true;
      window.setTimeout(() => window.location.reload(), 80);
    };

    const enhance = () => {
      document.querySelectorAll<HTMLElement>("article.chat-message.mine").forEach((article) => {
        if (article.dataset.recallEnhanced === "1") return;
        const rawId = article.id.startsWith("chat-msg-") ? article.id.slice(9) : "";
        if (!UUID_RE.test(rawId)) return;
        const bubble = article.querySelector<HTMLElement>(".chat-bubble");
        if (!bubble) return;
        if (bubble.dataset.recalled === "1" || bubble.textContent?.trim() === "此訊息已收回") return;

        const meta = article.querySelector<HTMLElement>(".chat-meta-outside");
        if (!meta) return;
        article.dataset.recallEnhanced = "1";
        const button = document.createElement("button");
        button.type = "button";
        button.textContent = "收回";
        button.setAttribute("aria-label", "收回這則訊息");
        button.style.cssText = "border:0;background:transparent;color:inherit;opacity:.62;font-size:12px;padding:2px 4px;margin-right:4px;cursor:pointer;";
        button.addEventListener("click", async (event) => {
          event.preventDefault();
          event.stopPropagation();
          if (button.disabled) return;
          if (!window.confirm("確定要收回這則訊息嗎？")) return;
          button.disabled = true;
          button.textContent = "收回中…";
          const { error } = await supabase.rpc("recall_random_message", { p_message_id: rawId });
          if (error) {
            button.disabled = false;
            button.textContent = "收回";
            window.alert("目前無法收回訊息，請稍後再試。");
            return;
          }
          refresh();
        });
        meta.prepend(button);
      });
    };

    enhance();
    const observer = new MutationObserver(enhance);
    observer.observe(document.body, { childList: true, subtree: true });

    const channel = supabase
      .channel(`message-recall-${sessionId}`)
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "random_chat_messages", filter: `session_id=eq.${sessionId}` }, (payload: { new?: { recalled_at?: string | null } }) => {
        if (payload.new?.recalled_at) refresh();
      })
      .subscribe();

    return () => {
      disposed = true;
      observer.disconnect();
      void supabase.removeChannel(channel);
    };
  }, [sessionId]);

  return null;
}
