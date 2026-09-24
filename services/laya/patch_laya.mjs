import fs from "node:fs";

const file = "node_modules/@receptron/laya/dist/laya.js";
let source = fs.readFileSync(file, "utf8");

const oldLine =
  'const ids = { cls: id("[CLS]"), sep: id("[SEP]"), mask: id("[MASK]"), pad: id("[PAD]"), maskTok: "[MASK]" };';

const replacement = `const special = config.special_tokens ?? {};
        const clsTok = special.cls ?? "[CLS]";
        const sepTok = special.sep ?? "[SEP]";
        const maskTok = special.mask ?? "[MASK]";
        const padTok = special.pad ?? "[PAD]";
        const ids = { cls: id(clsTok), sep: id(sepTok), mask: id(maskTok), pad: id(padTok), maskTok };`;

if (!source.includes(oldLine)) {
  throw new Error("Unable to patch @receptron/laya special-token lookup");
}

source = source.replace(oldLine, replacement);
fs.writeFileSync(file, source);
console.log("[build] patched @receptron/laya multilingual special-token lookup");
