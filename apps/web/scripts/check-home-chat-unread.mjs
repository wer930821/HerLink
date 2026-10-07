import fs from "node:fs";
const s=fs.readFileSync(new URL("../app/page.tsx",import.meta.url),"utf8");
if(!s.includes("get_my_random_chat_unread_count")) throw new Error("missing unread count RPC");
if(!s.includes("home-chat-unread")) throw new Error("missing My Chats unread badge");
if(s.includes("contacts-chat-unread")) throw new Error("Contacts must not show unread badge");
console.log("home My Chats unread badge verified");
