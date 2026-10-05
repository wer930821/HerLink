"use client";

import dynamic from "next/dynamic";

const RandomSessionClient = dynamic(() => import("./RandomSessionClient"), {
  ssr: false,
  loading: () => (
    <main className="chat-page">
      <section className="chat-shell">
        <div className="notice">聊天室載入中…</div>
      </section>
    </main>
  ),
});

export default function RandomSessionPage() {
  return <RandomSessionClient />;
}
