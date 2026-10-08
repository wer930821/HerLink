import path from "node:path";

import type { RepairProposal } from "./types";

export type PolicyResult = { ok: true } | { ok: false; reason: string };

const ALLOWED_PREFIXES = ["apps/web/", "tests/"];
const FORBIDDEN_PREFIXES = ["supabase/", ".github/", "secrets/"];

function normalizeRepoPath(input: string): string | null {
  try {
    let decoded = input;
    for (let i = 0; i < 2; i += 1) decoded = decodeURIComponent(decoded);
    const slashPath = decoded.replaceAll("\\", "/");
    if (slashPath.startsWith("/") || slashPath.includes("\0")) return null;
    const normalized = path.posix.normalize(slashPath);
    if (normalized === ".." || normalized.startsWith("../")) return null;
    return normalized.replace(/^\.\//, "");
  } catch {
    return null;
  }
}

function isForbiddenPath(repoPath: string): boolean {
  const lower = repoPath.toLowerCase();
  const base = path.posix.basename(lower);
  if (FORBIDDEN_PREFIXES.some((prefix) => lower.startsWith(prefix))) return true;
  if (lower.endsWith(".sql")) return true;
  if (base === ".env" || base.startsWith(".env.")) return true;
  if (lower.includes("/secrets/") || lower.startsWith("secrets/")) return true;
  return false;
}

export function validateRepairProposal(proposal: RepairProposal): PolicyResult {
  if (proposal.operation !== "replace_file") return { ok: false, reason: "operation_not_allowed" };
  if (!/^ai-repair\/[a-zA-Z0-9._-]+$/.test(proposal.branch) || proposal.branch === "main") {
    return { ok: false, reason: "branch_not_allowed" };
  }

  const repoPath = normalizeRepoPath(proposal.path);
  if (!repoPath) return { ok: false, reason: "invalid_path" };
  if (isForbiddenPath(repoPath)) return { ok: false, reason: "path_forbidden" };
  if (!ALLOWED_PREFIXES.some((prefix) => repoPath.startsWith(prefix))) {
    return { ok: false, reason: "path_not_allowlisted" };
  }
  if (typeof proposal.content !== "string") return { ok: false, reason: "content_required" };

  return { ok: true };
}
