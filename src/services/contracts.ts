import type {
  ApprovedResult,
  ChemicalRecord,
  RequestInput,
  RequestStatus,
  Solution,
} from "../domain";
export interface Evidence {
  title: string;
  url: string;
  retrievedAt: string;
  excerpt: string;
  documentHash: string;
}
export interface Identification {
  candidates: Array<{ chemical: ChemicalRecord; confidence: number }>;
  labelText: string;
  requiresUserConfirmation: true;
}
export interface PreliminaryAssessment {
  requestId: string;
  identityResults: Identification[];
  summary: string;
  missingInformation: string[];
  evidence: Evidence[];
  conditions: string;
  notForPublication: true;
}
export interface ChemicalIdentificationService {
  identify(imageReference: string): Promise<Identification>;
}
export interface ChemicalDatabaseService {
  search(query: string): Promise<ChemicalRecord[]>;
  get(id: string): Promise<ChemicalRecord | undefined>;
}
export interface SafetyDataService {
  retrieve(solution: Solution): Promise<Evidence[]>;
}
export interface ChemicalCompatibilityService {
  assess(
    requestId: string,
    input: RequestInput,
    evidence: Evidence[],
  ): Promise<PreliminaryAssessment>;
}
export interface AgentOrchestrator {
  run(
    requestId: string,
    input: RequestInput,
  ): Promise<{ reviewTicketId: string }>;
}
export interface AdminReviewService {
  submit(
    requestId: string,
    input: RequestInput,
    assessment: PreliminaryAssessment,
  ): Promise<{ reviewTicketId: string }>;
}
export interface ServerRequest {
  id: string;
  status: RequestStatus;
  createdAt: string;
  input: RequestInput;
  history: Array<{ status: RequestStatus; at: string; actorId: string }>;
  result?: ApprovedResult;
}
export interface RequestRepository {
  create(input: RequestInput, ownerId: string): Promise<ServerRequest>;
  get(id: string, ownerId: string): Promise<ServerRequest | undefined>;
}
export interface AdminReviewDecision {
  schemaVersion: 1;
  eventId: string;
  requestId: string;
  assessmentVersion: number;
  reviewerId: string;
  decision:
    | "approved"
    | "rejected"
    | "additional_information_required"
    | "unable_to_determine";
  reviewedAt: string;
  reason: string;
  approvedResult?: ApprovedResult;
}
