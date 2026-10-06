"use client";

// Legacy recall test panel intentionally disabled.
// Message recall is handled by the main chat UI and synchronized through
// random_chat_messages Realtime updates. Keeping a second recall renderer here
// caused direct DOM mutations to race React on mobile browsers.
export default function RecallMessageNative() {
  return null;
}
