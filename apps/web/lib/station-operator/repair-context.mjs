import { validateRepairFiles } from './repair.mjs';

const MAX_CONTEXT_FILES = 5;
const MAX_QUERY_LENGTH = 240;
const UNSAFE_QUERY = /(?:thread[_ -]?id|message[_ -]?id|bearer|service[_ -]?role|secret|api[_ -]?key|token|password)\s*(?:=|:)?\s*\S*/i;

function cleanPart(value) {
  return String(value ?? '')
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/[^\p{L}\p{N}_\- ]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function buildRepairContextQuery({ summary, area, feature, symptom } = {}) {
  const raw = [summary, area, feature, symptom].map(value => String(value ?? '')).join(' ');
  if (!raw.trim() || UNSAFE_QUERY.test(raw)) return { ok: false, reason: 'unsafe_query' };

  const query = [cleanPart(area), cleanPart(feature), cleanPart(symptom), cleanPart(summary)]
    .filter(Boolean)
    .join(' ')
    .slice(0, MAX_QUERY_LENGTH)
    .trim();

  if (!query) return { ok: false, reason: 'empty_query' };
  return { ok: true, query };
}

export function validateRepairContextFiles(files = []) {
  if (!Array.isArray(files) || files.length === 0 || files.length > MAX_CONTEXT_FILES) {
    return { ok: false, reason: 'invalid_file_count' };
  }

  const normalized = files.map(raw => String(raw ?? '').replace(/\\/g, '/').replace(/^\.\//, ''));
  if (normalized.some(path => !path) || new Set(normalized).size !== normalized.length) {
    return { ok: false, reason: 'duplicate_or_empty_file' };
  }

  const guarded = validateRepairFiles(normalized);
  if (!guarded.ok) return { ok: false, reason: 'unsafe_file', blocked: guarded.blocked };

  return { ok: true, files: normalized };
}
