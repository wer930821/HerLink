"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { supabase } from "../../../lib/supabase";

const LONELY_PENGUIN_ID = "e2817803-1304-4ef0-b0b8-66f473b12886";

type MessageRow = {
  id: string;
  created_at: string;
  is_mine: boolean;
  content: string;
  message_type: "text" | "image";
  recalled_at?: string | null;
};

export default function RecallMessageNative() {
  const params = useParams<{ id?: string }>();
  const sessionId = typeof params?.id === "string" ? params.id : "";
  const [allowed, setAllowed] = useState(false);
  const [messages, setMessages] = useState<MessageRow[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    const load = async () => {
      const { data: auth } = await supabase.auth.getSession();
      if (!active || auth.session?.user?.id !== LONELY_PENGUIN_ID) return;
      const { data: canRecall } = await supabase.rpc("can_test_message_recall", { p_session_id: sessionId });
      if (!active || canRecall !== true) return;
      setAllowed(true);
      const { data } = await supabase.rpc("list_random_messages_v2", {
        p_session_id: sessionId,
        p_limit: 100,
        p_before_created_at: null,
        p_before_id: null,
        p_after_created_at: null,
        p_after_id: null,
      });
      if (active && Array.isArray(data)) setMessages(data as MessageRow[]);
    };
    void load();
    return () => { active = false; };
  }, [sessionId]);

  if (!allowed) return null;

  const ownMessages = messages.filter((message) => message.is_mine).slice(-20);
  if (!ownMessages.length) return null;

  return (
    <section aria-label="孤星企鵝收回測試" style={{ position: "fixed", right: 12, bottom: 92, zIndex: 2147483000, width: "min(320px, calc(100vw - 24px))", maxHeight: "42vh", overflow: "auto", borderRadius: 16, padding: 12, background: "rgba(24,18,28,.96)", color: "white", boxShadow: "0 12px 40px rgba(0,0,0,.32)" }}>
      <div style={{ fontWeight: 900, marginBottom: 8 }}>訊息收回測試</div>
      {ownMessages.map((message) => (
        <div key={message.id} style={{ display: "flex", gap: 8, alignItems: "center", padding: "7px 0", borderTop: "1px solid rgba(255,255,255,.1)" }}>
          <div style={{ flex: 1, minWidth: 0, fontSize: 12, opacity: .9, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {message.recalled_at ? "此訊息已收回" : message.message_type === "image" ? "圖片" : message.content || "訊息"}
          </div>
          {!message.recalled_at ? (
            <button type="button" disabled={busyId === message.id} onClick={async () => {
              if (!window.confirm("確定要收回這則訊息嗎？")) return;
              setBusyId(message.id);
              const { error } = await supabase.rpc("recall_random_message", { p_message_id: message.id });
              setBusyId(null);
              if (error) { window.alert("目前無法收回訊息，請稍後再試。"); return; }
              setMessages((current) => current.map((item) => item.id === message.id ? { ...item, recalled_at: new Date().toISOString(), content: "" } : item));
              window.location.reload();
            }} style={{ border: "1px solid #ff8ab2", borderRadius: 999, padding: "5px 9px", background: "transparent", color: "#ffb1cb", fontWeight: 800 }}>
              {busyId === message.id ? "收回中…" : "收回"}
            </button>
          ) : null}
        </div>
      ))}
    </section>
  );
}
