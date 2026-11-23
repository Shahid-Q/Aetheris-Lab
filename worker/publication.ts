import { finalResultSchema, type ApprovedResult } from "../src/domain";
// Called only by future server repository code AFTER owner authentication and durable review lookup.
// This context must never be constructed from a request body or browser storage.
export interface VerifiedReviewContext {
  requestId: string;
  assessmentVersion: number;
  currentAssessmentVersion: number;
  decision:
    | "approved"
    | "rejected"
    | "additional_information_required"
    | "unable_to_determine";
  reviewerId: string;
  reviewedAt: string;
  authenticatedReviewer: boolean;
  signatureVerified: boolean;
  revoked: boolean;
  result: unknown;
}
export function publishableResult(
  review: VerifiedReviewContext | undefined,
): ApprovedResult | null {
  if (
    !review ||
    review.decision !== "approved" ||
    !review.authenticatedReviewer ||
    !review.signatureVerified ||
    review.revoked ||
    review.assessmentVersion !== review.currentAssessmentVersion
  )
    return null;
  const result = finalResultSchema.safeParse(review.result);
  if (
    !result.success ||
    result.data.reviewerId !== review.reviewerId ||
    result.data.reviewedAt !== review.reviewedAt
  )
    return null;
  return result.data;
}
