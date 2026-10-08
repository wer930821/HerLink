export const AI_HELPER_TRIGGER_MS = 20_000;
export const AI_HANDOFF_TIMEOUT_MS = 10_000;
export const AI_MAX_HANDOFF_REJECTIONS = 3;

const AI_HELPER_TEST_DISPLAY_NAME = "孤星企鵝";

export function isAiHelperTester(displayName: string | null | undefined): boolean {
  return displayName === AI_HELPER_TEST_DISPLAY_NAME;
}

export type AiHelperOfferInput = {
  displayName: string | null | undefined;
  elapsedMs: number;
  hasHumanSession: boolean;
  aiAlreadyOffered?: boolean;
};

export function shouldOfferAiHelper(input: AiHelperOfferInput): boolean {
  return (
    isAiHelperTester(input.displayName) &&
    input.elapsedMs >= AI_HELPER_TRIGGER_MS &&
    !input.hasHumanSession &&
    !input.aiAlreadyOffered
  );
}

export type HandoffAction = "reject" | "timeout" | "restart";

export function nextHandoffState(input: {
  rejectionCount: number;
  action: HandoffAction;
}): { rejectionCount: number; pauseMatching: boolean } {
  if (input.action === "restart") {
    return { rejectionCount: 0, pauseMatching: false };
  }

  const rejectionCount = Math.min(
    Math.max(0, input.rejectionCount) + 1,
    AI_MAX_HANDOFF_REJECTIONS,
  );

  return {
    rejectionCount,
    pauseMatching: rejectionCount >= AI_MAX_HANDOFF_REJECTIONS,
  };
}
