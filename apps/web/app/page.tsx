"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type MouseEvent } from "react";
import { usePathname, useRouter } from "next/navigation";
import {
  ANONYMOUS_DISPLAY_NAME_MAX_LENGTH,
  randomizeAnonymousDisplayName,
  renameAnonymousDisplayName,
  validateAnonymousDisplayNameDraft,
  anonymousRenameErrorMessage,
} from "../lib/anonymous-rename";
import { getFriendlyAuthErrorMessage } from "../lib/auth-ui";
import {
  getShortId,
  isNavigationDebugEnabled,
  readLastNavigationDiagnostic,
  recordNavigationDiagnostic,
  withNavigationDebugParam,
  type NavigationDiagnosticEvent,
} from "../lib/navigation-diagnostics";
import { useOnlinePresence } from "../lib/realtime-presence";
import { MAINTENANCE_MESSAGE, MAINTENANCE_MODE, MAINTENANCE_TITLE } from "../lib/site-config";
import {
  buildBrowserHandoffUrl,
  findOrJoinRandomMatch,
  getCurrentSession,
  ensureAnonymousBootstrapProfile,
  ensureMyAdminFixedAnonymousIdentity,
  isSupabaseConfigured,
  leaveRandomQueue,
  leaveRandomSession,
  loadMyActiveRandomSession,
  loadMyLatestRandomSessionDiagnostic,
  loadMyProfile,
  loadMyRandomQueue,
  registerAnonymousAbuseIdentity,
  signInAnonymously,
  waitForCurrentSession,
  requestRandomIdentityRecovery,
  signOut,
  type RandomQueueRow,
  type RandomSessionRow,
  type LatestRandomSessionDiagnosticRow,
  type Session,
  type AnonymousAbusePrecheckRow,
  type WebProfile,
  supabase,
} from "../lib/supabase";
import { Badge, Button, Field, Modal, Notice, PageHero, Surface } from "../components/ui";
import { createPermanentRecoveryCode, getPermanentRecoveryStatus, rotatePermanentRecoveryCode, type RecoveryCodeStatus } from "../lib/permanent-recovery-code";

type BootstrapState = {
  session: Session | null;
  profile: WebProfile | null;
  queue: RandomQueueRow | null;
  activeSession: RandomSessionRow | null;
};

type ActiveSessionLookup = {
  result: "loading" | "RPC SUCCESS" | "NOT FOUND" | "RPC ERROR";
  error: string | null;
};

const emptyBootstrapState: BootstrapState = {
  session: null,
  profile: null,
  queue: null,
  activeSession: null,
};

const initialActiveSessionLookup: ActiveSessionLookup = {
  result: "loading",
  error: null,
};

const WAITING_COUNT_POLL_MS = 60_000;
const WAITING_COUNT_REFRESH_DEDUPE_MS = 5_000;

function summarizeActiveSessionRpcError(error: { code?: unknown; message?: unknown } | null) {
  const code = typeof error?.code === "string" && error.code ? error.code.slice(0, 40) : "RPC_ERROR";
  const message = typeof error?.message === "string" && error.message
    ? error.message
      .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, "[id]")
      .replace(/[^\s@]+@[^\s@]+/g, "[email]")
      .replace(/[A-Za-z0-9_-]{24,}\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}/g, "[token]")
      .replace(/(token|apikey|authorization)\s*[=:]\s*\S+/gi, "$1=[redacted]")
      .replace(/\s+/g, " ")
      .slice(0, 160)
    : "Active session RPC failed.";
  return `${code}: ${message}`;
}

PLACEHOLDER_REST
