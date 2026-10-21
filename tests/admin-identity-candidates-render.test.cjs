const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

test('mailbox renders automatic identity candidates including empty state and selection action',()=>{
  const page=fs.readFileSync(path.join(__dirname,'..','apps','web','app','admin','mailbox','page.tsx'),'utf8');
  assert.match(page,/可能的舊匿名身分/);
  assert.match(page,/identityCandidates\.map/);
  assert.match(page,/目前未找到/);
  assert.match(page,/聊天室/);
  assert.match(page,/訊息/);
  assert.match(page,/匿名聯絡人/);
});

test('current sender identity is display-only and cannot enter manual claim preflight',()=>{
  const page=fs.readFileSync(path.join(__dirname,'..','apps','web','app','admin','mailbox','page.tsx'),'utf8');
  assert.match(page,/目前使用中的身分，不需接回/);
  assert.match(page,/const historicalIdentityCandidates=identityCandidates\.filter\(candidate=>candidate\.source!=="寄件者目前匿名身分"\)/);
  assert.match(page,/historicalIdentityCandidates\.map/);
});
