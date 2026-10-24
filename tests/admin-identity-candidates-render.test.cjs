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

test('identity candidate RPC uses the same current-sender source label as the mailbox UI',()=>{
  const migrations=fs.readdirSync(path.join(__dirname,'..','supabase','migrations'))
    .filter(name=>name.endsWith('.sql'))
    .map(name=>fs.readFileSync(path.join(__dirname,'..','supabase','migrations',name),'utf8'))
    .join('\n');
  const definitions=[...migrations.matchAll(/create\s+or\s+replace\s+function\s+public\.station_mail_admin_identity_candidates[\s\S]*?\$\$;?/gi)];
  assert.ok(definitions.length>0,'station_mail_admin_identity_candidates must exist');
  const latest=definitions.at(-1)[0];
  assert.match(latest,/寄件者目前匿名身分/);
  assert.doesNotMatch(latest,/目前登入匿名身分/);
});
