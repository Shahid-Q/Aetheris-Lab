import { z } from "zod";
import { finalResultSchema, publicRequestIdSchema, type PublicResult, type RequestInput } from "./domain";

export type SolutionSide = "A" | "B";
export type AgentStatus = "running" | "completed" | "unconfigured" | "failed";
export type EvidenceSource = "PubChem" | "NIOSH";
export type EvidenceKind = "identity" | "hazard" | "incompatibility";
export interface Evidence {
  id: string;
  source: EvidenceSource;
  kind: EvidenceKind;
  solution: SolutionSide;
  title: string;
  url: string;
  excerpt: string;
  retrievedAt: string;
}

export interface Identity {
  solution: SolutionSide;
  state: "matched" | "ambiguous" | "missing";
  records: { name: string; formula: string; cid: number }[];
}

export type GapCode =
  | "identity"
  | "identifierUnverified"
  | "concentration"
  | "solvent"
  | "state"
  | "temperature"
  | "quantity"
  | "conditions"
  | "hazards"
  | "incompatibilities"
  | "pubchemUnavailable"
  | "nioshUnavailable"
  | "nioshNoRecord";

export interface EvidenceGap {
  code: GapCode;
  solution?: SolutionSide;
}

export const assessmentSchema = z.strictObject({
  hazardEvidenceIds: z.array(z.uuidv4()).max(12),
  pairConcernEvidenceIds: z.array(z.uuidv4()).max(8),
  uncertainty: z.array(z.enum([
    "substanceOnly",
    "indirectEvidence",
    "conflictingEvidence",
    "formulationUnknown",
    "pairEvidenceMissing",
  ])).max(5),
});
export type AgentAssessment = z.infer<typeof assessmentSchema>;

export interface PreliminaryReport {
  identities: Identity[];
  gaps: EvidenceGap[];
  assessment: AgentAssessment | null;
}

export const reviewDecisions = ["Approved", "Rejected", "Needs More Information"] as const;
export type ReviewDecision = typeof reviewDecisions[number];
const text = z.string().trim().min(1).max(2500);
const source = z.strictObject({
  title: z.string().trim().min(1).max(250),
  url: z.url({ protocol: /^https$/ }).max(1500).refine((value) => {
    const url = new URL(value);
    return !url.username && !url.password;
  }),
});
const approvalSchema = z.strictObject({
  classification: finalResultSchema.shape.classification,
  conditions: text,
  hazards: z.array(text).max(12),
  incompatibilities: z.array(text).max(12),
  storage: text,
  container: text,
  limitations: z.array(text).min(1).max(12),
  evidenceIds: z.array(publicRequestIdSchema).max(20),
  externalSources: z.array(source).max(5),
  attestation: z.literal(true),
}).refine(({ evidenceIds, externalSources }) => evidenceIds.length + externalSources.length > 0);
export const reviewInputSchema = z.discriminatedUnion("decision", [
  z.strictObject({
    runId: publicRequestIdSchema,
    decision: z.literal("Approved"),
    notes: text,
    result: approvalSchema,
  }),
  z.strictObject({
    runId: publicRequestIdSchema,
    decision: z.enum(["Rejected", "Needs More Information"]),
    notes: text,
  }),
]);
export const retryInputSchema = z.strictObject({ runId: publicRequestIdSchema });
export const adminManageLimit = 30;
const adminManageActions = ["archive", "restore", "delete"] as const;
export type AdminManageAction = typeof adminManageActions[number];
export const adminManageSchema = z.strictObject({
  action: z.enum(adminManageActions),
  ids: z.array(publicRequestIdSchema).min(1).max(adminManageLimit),
});

export interface AdminRequestDetail {
  id: string;
  archivedAt: string | null;
  status: import("./domain").PublicRequestStatus;
  createdAt: string;
  updatedAt: string;
  input: RequestInput;
  images: { id: string; solution: SolutionSide }[];
  run: {
    id: string;
    status: AgentStatus;
    failureCode: string | null;
    provider: string | null;
    model: string | null;
  } | null;
  report: PreliminaryReport | null;
  evidence: Evidence[];
  review: { decision: ReviewDecision; reviewerId: string; notes: string; createdAt: string } | null;
  approvedResult: PublicResult | null;
  history: { id: number; status: import("./domain").PublicRequestStatus; actor: string; createdAt: string }[];
  canRetry: boolean;
}

export interface AdminRequestList {
  requests: {
    id: string;
    status: import("./domain").PublicRequestStatus;
    createdAt: string;
    nameA: string;
    nameB: string;
  }[];
  next: string | null;
}
