import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const css = await readFile(path.join(root, "apps/web/app/globals.css"), "utf8");
const page = await readFile(path.join(root, "apps/web/app/session/[id]/page.tsx"), "utf8");

const chatShell = css.match(/\.chat-shell\s*\{([\s\S]*?)\n\}/)?.[1] ?? "";
const messages = css.match(/\.chat-messages\s*\{([\s\S]*?)\n\}/)?.[1] ?? "";

assert.match(chatShell, /height:\s*calc\(100dvh - 48px\)/, "chat shell must have a bounded viewport height");
assert.match(chatShell, /max-height:\s*calc\(100dvh - 48px\)/, "chat shell must not grow past the viewport");
assert.match(chatShell, /min-height:\s*0/, "chat shell must permit its flex children to shrink");
assert.match(messages, /flex:\s*1 1 auto/, "message list must fill the chat shell");
assert.match(messages, /min-height:\s*0/, "message list must shrink into its scroll area");
assert.match(messages, /overflow-y:\s*auto/, "message list must be the vertical scroll container");
assert.match(messages, /touch-action:\s*pan-y/, "message list must permit mobile vertical pan");
assert.doesNotMatch(css, /touch-action:\s*none/, "mobile scrolling must not be disabled");
assert.doesNotMatch(page, /touchmove/, "chat page must not cancel touch scrolling");
assert.doesNotMatch(page, /scrollIntoView/, "auto-scroll must not move the page body");
assert.match(page, /if \(!pendingScrollToBottomRef\.current && !stickToBottomRef\.current\)\s*\{/, "history readers must not be forced to bottom");
assert.match(page, /if \(\(forceScroll \|\| receivedNewMessage\) && stickToBottomRef\.current\)/, "new messages should follow only near the bottom");
assert.match(page, /const typingIndicatorText = partnerTyping \?/, "typing updates must not invoke scrolling");

console.log("mobile chat scroll regression: PASS");
