import {
  localRequestSchema,
  type LocalRequest,
  type RequestInput,
  requestInputSchema,
} from "../domain";
import { chemicals, searchChemicals } from "../data/chemicals";
import type {
  ChemicalDatabaseService,
  ChemicalIdentificationService,
} from "./contracts";
const KEY = "aetheris.requests.v1";
export const catalog: ChemicalDatabaseService = {
  search: async (q) => searchChemicals(q),
  get: async (id) => chemicals.find((c) => c.id === id),
};
export const identification: ChemicalIdentificationService = {
  identify: async () => {
    throw new Error(
      "AI identification unavailable. Confirm the identity using the label and manual entry.",
    );
  },
};
export function listLocalRequests(): LocalRequest[] {
  const raw = localStorage.getItem(KEY);
  if (!raw) return [];
  const parsed = localRequestSchema.array().safeParse(JSON.parse(raw));
  if (!parsed.success)
    throw new Error(
      "Saved request data could not be read. Export or clear this browser’s site data to recover.",
    );
  return parsed.data;
}
export function saveLocalRequest(input: RequestInput): LocalRequest {
  const at = new Date().toISOString();
  const request: LocalRequest = {
    ...requestInputSchema.parse(input),
    id: crypto.randomUUID(),
    createdAt: at,
    status: "Draft",
    mode: "draft",
    history: [
      {
        status: "Draft",
        at,
        note: "Local draft saved in this browser.",
      },
    ],
  };
  localStorage.setItem(KEY, JSON.stringify([request, ...listLocalRequests()]));
  return request;
}
