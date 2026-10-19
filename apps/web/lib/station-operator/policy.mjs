const KINDS = new Set(['reply','bug_repair','human_review','ignore']);
const SAFE_ACTIONS = new Set(['create_bug_repair']);
const DANGEROUS_ACTIONS = new Set(['delete_data','billing_change','secret_change','permission_escalation','production_migration']);

export function requiresHumanReview(actions = []) {
  return actions.some((action) => DANGEROUS_ACTIONS.has(action));
}

export function validateDecision(input) {
  if (!input || typeof input !== 'object' || !KINDS.has(input.kind)) throw new Error('invalid kind');
  if (typeof input.reply !== 'string') throw new Error('invalid reply');
  if (!Array.isArray(input.actions)) throw new Error('invalid actions');
  for (const action of input.actions) {
    if (!SAFE_ACTIONS.has(action) && !DANGEROUS_ACTIONS.has(action)) throw new Error('action not allowed');
  }
  const confidence = Number(input.confidence);
  if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) throw new Error('invalid confidence');
  const needsHuman = Boolean(input.needsHuman) || requiresHumanReview(input.actions);
  if (input.kind === 'bug_repair' && input.actions.some((a) => a !== 'create_bug_repair')) throw new Error('invalid bug action');
  return { kind: input.kind, reply: input.reply.trim(), actions: [...input.actions], confidence, needsHuman };
}

export const decisionJsonSchema = {
  type: 'object', additionalProperties: false,
  required: ['kind','reply','actions','confidence','needsHuman'],
  properties: {
    kind: { type:'string', enum:['reply','bug_repair','human_review','ignore'] },
    reply: { type:'string', maxLength:2000 },
    actions: { type:'array', items:{ type:'string', enum:[...SAFE_ACTIONS, ...DANGEROUS_ACTIONS] }, maxItems:3 },
    confidence: { type:'number', minimum:0, maximum:1 },
    needsHuman: { type:'boolean' }
  }
};
