import fs from "node:fs";
import path from "node:path";

const sourcePath = path.resolve(process.cwd(), "app/session/[id]/RandomSessionClient.tsx");
const source = fs.readFileSync(sourcePath, "utf8");
const start = source.indexOf("const maybeTriggerEasterEgg = (content: string) => {");
const end = source.indexOf("\n  const ", start + 1);
if (start < 0 || end < 0) {
  throw new Error("找不到 maybeTriggerEasterEgg 區段");
}
const block = source.slice(start, end);
for (const egg of ["midnight", "threeam", "weekend"]) {
  if (block.includes(`triggerEasterEgg(\"${egg}\"`)) {
    throw new Error(`${egg} 不可在每次送訊息時直接觸發`);
  }
}
console.log("PASS: 午夜／03:00／週末彩蛋皆不會由每則訊息直接觸發");
