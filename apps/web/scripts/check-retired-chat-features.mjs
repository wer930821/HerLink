import fs from "node:fs";
const source = fs.readFileSync(new URL("../app/session/[id]/RandomSessionClient.tsx", import.meta.url), "utf8");
if (!source.includes("{false && assistantAllowed ? (")) throw new Error("聊天小助手入口仍可能顯示");
if (source.includes("chat-assist-card")) throw new Error("聊天小助手面板仍存在");
if (source.includes("icebreaker_prompt") || source.includes("icebreaker_question_code")) throw new Error("聊天室前端仍引用破冰題");
console.log("retired chat features are not exposed");
