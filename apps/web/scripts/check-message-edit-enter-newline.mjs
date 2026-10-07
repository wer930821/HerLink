import fs from "node:fs";

const source = fs.readFileSync(new URL("../app/session/[id]/page.tsx", import.meta.url), "utf8");

const checks = [
  [source.includes('supabase.rpc("edit_random_message"'), "own text messages can call edit_random_message"],
  [source.includes('>編輯</button>'), "own-message menu exposes 編輯"],
  [source.includes('event.key !== "Enter"'), "composer capture handles Enter separately"],
  [source.includes('setRangeText("\\n"'), "Enter inserts a newline instead of sending"],
];

const failed = checks.filter(([ok]) => !ok).map(([, label]) => label);
if (failed.length) {
  console.error(`message editing/newline checks failed:\n- ${failed.join("\n- ")}`);
  process.exit(1);
}
console.log("message editing/newline checks passed");
