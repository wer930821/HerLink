export type RepairStatus =
  | "queued"
  | "diagnosing"
  | "editing"
  | "verifying"
  | "retrying"
  | "ready_for_review"
  | "needs_human"
  | "blocked";

export type RepairOperation = "replace_file";

export type RepairProposal = {
  operation: RepairOperation | string;
  branch: string;
  path: string;
  content?: string;
  diagnosis?: string;
  rationale?: string;
};

export type RepairAttempt = {
  number: 1 | 2;
  status: RepairStatus;
  failure?: string;
};

export type RepairJob = {
  id: string;
  source: "manual" | "automatic";
  title: string;
  description: string;
  status: RepairStatus;
  attempts: RepairAttempt[];
};
