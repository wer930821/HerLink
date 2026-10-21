import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const page = fs.readFileSync(new URL('../app/admin/mailbox/page.tsx', import.meta.url), 'utf8');

test('人工接回完成訊息只在信件內容區顯示，不在收件匣入口顯示', () => {
  assert.match(page, /人工接回完成；聊天室、訊息與匿名聯絡人數量已核對一致。/);
  assert.doesNotMatch(page, /setErr\("人工接回完成；聊天室、訊息與匿名聯絡人數量已核對一致。"\)/);
  assert.match(page, /setPreflight\(\{\.\.\.preflight,conflict_code:"人工接回完成；聊天室、訊息與匿名聯絡人數量已核對一致。"\}\)/);
});
