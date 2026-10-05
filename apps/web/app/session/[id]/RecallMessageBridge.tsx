"use client";

import { useEffect } from "react";
import { useParams } from "next/navigation";
import { loadMyProfile, supabase } from "../../../lib/supabase";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{12}$/i;

type RecallProjection = { id: string; recalled_at?: string | null };

export default function RecallMessageBridge() {
  const params = useParams<{ id?: string }>();
  const sessionId = typeof params?.id === "string" ? params.id : "";

  useEffect(() => {
    if (!sessionId || !UUID_RE.test(sessionId)) return;
    let disposed = false;
    let observer: MutationObserver | null = null;
    const recalledIds = new Set<string>();

    const run = async () => {
      const { data: auth } = await supabase.auth.getUser();
      if (disposed || !auth.user) return;
      const { data: profile } = await loadMyProfile(auth.user.id);
      if (disposed || profile?.anonymous_display_name !== "孤星企鵝") return;

      const enhance = () => {
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
            article.querySelector<HTMLButtonElement>("button[data-message-recall]")?.remove();
            return;
          }

          if (!article.classList.contains("mine") || article.querySelector("button[data-message-recall]")) return;
          const meta = article.querySelector<HTMLElement>(".chat-meta-outside");
          if (!meta) return;
          const button = document.createElement("button");
          button.type = "button";
          button.dataset.messageRecall = "1";
          button.textContent = "收回";
          button.setAttribute("aria-label", "收回這則訊息");
          button.style.cssText = "border:0;background:transparent;color:inherit;opacity:.68;font-size:12px;padding:2px 5px;margin-right:4px;cursor:pointer;";
          button.addEventListener("click", async (event) => {
            event.preventDefault();
            event.stopPropagation();
            if (button.disabled || !window.confirm("確定要收回這則訊息嗎？")) return;
            button.disabled = true;
            button.textContent = "收回中…";
            const { error } = await supabase.rpc("recall_random_message", { p_message_id: rawId });
            if (error) {
              button.disabled = false;
              button.textContent = "收回";
              window.alert("目前無法收回訊息，請稍後再試。");
              return;
            }
            recalledIds.add(rawId);
            enhance();
          });
          meta.prepend(button);
        });
      };

      const syncRecallState = async () => {
        const { data, error } = await supabase.rpc("list_random_messages_v2", {
          p_session_id: sessionId,
          p_limit: 100,
          p_before_created_at: null,
          p_before_id: null,
          p_after_created_at: null,
          p_after_id: null,
        });
        if (disposed || error || !Array.isArray(data)) return;
        recalledIds.clear();
        for (const row of data as RecallProjection[]) if (row.recalled_at) recalledIds.add(row.id);
        enhance();
      };

      await syncRecallState();
      if (disposed) return;
      observer = new MutationObserver(enhance);
      observer.observe(document.body, { childList: true, subtree: true });
    };

    void run();
    return () => {
      disposed = true;
      observer?.disconnect();
    };
  }, [sessionId]);

  return null;
}
