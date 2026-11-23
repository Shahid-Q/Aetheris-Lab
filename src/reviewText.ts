import type { PublicRequestStatus, PublicResult } from "./domain";
import type { TextKey } from "./i18n";

export const statusLabel: Record<PublicRequestStatus, TextKey> = {
  Submitted: "submitted",
  Analyzing: "analyzingStatus",
  "Pending Review": "pendingReviewStatus",
  Approved: "approvedStatus",
  Rejected: "rejectedStatus",
  "Needs More Information": "needsMoreStatus",
};

export const resultLabel: Record<PublicResult["classification"], TextKey> = {
  "Compatible under documented conditions": "compatibleResult",
  Incompatible: "incompatibleResult",
  "Conditional or context-dependent": "conditionalResult",
  "Insufficient information": "insufficientResult",
};
