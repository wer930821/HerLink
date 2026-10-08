import { shouldOfferAiHelper } from "./ai-helper";

export type AiHelperOfferState = "hidden" | "offer";

export function getAiHelperOfferState(input: {
  displayName: string | null | undefined;
  elapsedMs: number;
  matched: boolean;
  dismissed: boolean;
}): AiHelperOfferState {
  return shouldOfferAiHelper({
    displayName: input.displayName,
    elapsedMs: input.elapsedMs,
    hasHumanSession: input.matched,
    aiAlreadyOffered: input.dismissed,
  })
    ? "offer"
    : "hidden";
}
