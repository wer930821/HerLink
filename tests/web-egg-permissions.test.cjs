const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const chat = fs.readFileSync(path.join(__dirname, '../apps/web/app/session/[id]/RandomSessionClient.tsx'), 'utf8');

test('milestone test controls are granted only by the lonely penguin display name', () => {
  assert.match(chat, /setMilestoneTestAllowed\(nextProfile\?\.anonymous_display_name === "孤星企鵝"\)/);
  assert.doesNotMatch(chat, /setMilestoneTestAllowed\([\s\S]{0,300}adminCheck\.data/);
  assert.doesNotMatch(chat, /setMilestoneTestAllowed\([\s\S]{0,300}ad9536fe-5ea0-4a1d-96d0-dcdecdafa18c/);
  assert.doesNotMatch(chat, /setMilestoneTestAllowed\([\s\S]{0,300}e2817803-1304-4ef0-b0b8-66f473b12886/);
});

test('normal collection text eggs are not gated by tester identity', () => {
  assert.doesNotMatch(chat, /if \(collectionTester\) \{[\s\S]{0,2500}午安/);
  assert.match(chat, /\/午安\/\.test\(normalized\).*triggerEasterEgg\("afternoon", true\)/);
  assert.match(chat, /\/命中注定\/\.test\(normalized\).*triggerEasterEgg\("destiny", true\)/);
});

test('all collection milestones can trigger without tester identity', () => {
  assert.doesNotMatch(chat, /milestone && \(collectionTester \|\|/);
  assert.match(chat, /if \(milestone\) triggerEasterEgg\(milestone, true\)/);
});
