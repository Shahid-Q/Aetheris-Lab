import { z } from "zod";
export const statuses = [
  "Draft",
  "Submitted",
  "Identifying Chemicals",
  "Analyzing",
  "Awaiting Administrator Review",
  "Additional Information Required",
  "Approved",
  "Rejected",
  "Unable to Determine",
  "Failed",
] as const;
export type RequestStatus = (typeof statuses)[number];
export const unknown = "Unknown";
const knownOrUnknown = z
  .string()
  .trim()
  .min(1, "Enter a value or mark Unknown.")
  .max(200);
const numberOrUnknown = z
  .string()
  .trim()
  .refine(
    (v) =>
      v === unknown ||
      (v !== "" && Number.isFinite(Number(v)) && Number(v) >= 0),
    "Enter a nonnegative number or Unknown.",
  );
export function validCas(value: string): boolean {
  if (value === unknown) return true;
  if (!/^\d{2,7}-\d{2}-\d$/.test(value)) return false;
  const digits = value.replaceAll("-", "");
  return (
    [...digits.slice(0, -1)]
      .reverse()
      .reduce((sum, d, i) => sum + Number(d) * (i + 1), 0) %
      10 ===
    Number(digits.at(-1))
  );
}
export const solutionSchema = z
  .object({
    name: knownOrUnknown,
    formula: knownOrUnknown,
    cas: knownOrUnknown.refine(
      validCas,
      "Enter a valid CAS number or Unknown.",
    ),
    concentration: numberOrUnknown,
    unit: z.enum(["% w/w", "% v/v", "mol/L", "g/L", "Unknown"]),
    solvent: knownOrUnknown,
    state: z.enum(["Liquid", "Solid", "Gas", "Unknown"]),
    temperature: z
      .string()
      .trim()
      .refine(
        (v) =>
          v === unknown ||
          (v !== "" && Number.isFinite(Number(v)) && Number(v) >= -273.15),
        "Enter °C above absolute zero or Unknown.",
      ),
    quantity: numberOrUnknown,
    quantityUnit: z.enum(["mL", "L", "g", "kg", "Unknown"]),
    notes: z.string().max(2000),
    source: z.enum(["Manual entry", "NIOSH catalog"]),
  })
  .superRefine((v, c) => {
    if (v.concentration !== unknown && v.unit === "Unknown")
      c.addIssue({
        code: "custom",
        path: ["unit"],
        message: "Choose a concentration unit.",
      });
    if (
      v.concentration !== unknown &&
      v.unit.startsWith("%") &&
      Number(v.concentration) > 100
    )
      c.addIssue({
        code: "custom",
        path: ["concentration"],
        message: "Percentage cannot exceed 100.",
      });
  });
export type Solution = z.infer<typeof solutionSchema>;
export const blankSolution: Solution = {
  name: "",
  formula: unknown,
  cas: unknown,
  concentration: unknown,
  unit: "Unknown",
  solvent: unknown,
  state: "Unknown",
  temperature: unknown,
  quantity: unknown,
  quantityUnit: "Unknown",
  notes: "",
  source: "Manual entry",
};
export const requestInputSchema = z.object({
  a: solutionSchema,
  b: solutionSchema,
  conditions: z.string().max(3000),
});
export type RequestInput = z.infer<typeof requestInputSchema>;
const decimal = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i;
export const publicSolutionSchema = solutionSchema.strict().superRefine((value, ctx) => {
  for (const field of ["concentration", "quantity", "temperature"] as const) {
    if (value[field] !== unknown && !decimal.test(value[field])) {
      ctx.addIssue({ code: "custom", path: [field], message: "Expected a decimal value." });
    }
  }
  if (value.quantity !== unknown && value.quantityUnit === unknown) {
    ctx.addIssue({ code: "custom", path: ["quantityUnit"], message: "Choose a quantity unit." });
  }
});
export const publicInputSchema = requestInputSchema.strict().extend({
  a: publicSolutionSchema,
  b: publicSolutionSchema,
});

export const publicRequestPath = "/api/requests";
export const publicRequestMaxBytes = 32 * 1024;
export const publicRequestIdSchema = z.uuidv4();
export const publicRequestStatuses = [
  "Submitted", "Analyzing", "Pending Review", "Approved", "Rejected", "Needs More Information",
] as const;
export const publicRequestStatusSchema = z.enum(publicRequestStatuses);
export type PublicRequestStatus = z.infer<typeof publicRequestStatusSchema>;
const receiptMetadata = z.object({
  id: publicRequestIdSchema,
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export const trackingTokenSchema = z.string().regex(/^[a-f0-9]{64}$/);
export const createdReceiptSchema = receiptMetadata.extend({
  status: z.literal("Submitted"),
  trackingToken: trackingTokenSchema,
});
export type CreatedReceipt = z.infer<typeof createdReceiptSchema>;

export const localRequestSchema = requestInputSchema.extend({
  id: z.string().uuid(),
  createdAt: z.iso.datetime(),
  status: z.enum(statuses).exclude(["Approved"]),
  mode: z.enum(["draft", "demo"]),
  history: z.array(
    z.object({
      status: z.enum(statuses).exclude(["Approved"]),
      at: z.iso.datetime(),
      note: z.string(),
    }),
  ),
});
export type LocalRequest = z.infer<typeof localRequestSchema>;
export interface ChemicalRecord {
  id: string;
  name: string;
  aliases: string[];
  formula: string;
  cas: string;
  category: string;
  mass: number;
  state: string;
  description: string;
  hazards: string;
  incompatibilities: string;
  source: string;
  verifiedOn: string;
}
export const finalResultSchema = z.object({
  classification: z.enum([
    "Compatible under documented conditions",
    "Incompatible",
    "Conditional or context-dependent",
    "Insufficient information",
  ]),
  conditions: z.string().min(1),
  hazards: z.array(z.string()),
  incompatibilities: z.array(z.string()),
  storage: z.string(),
  container: z.string(),
  limitations: z.array(z.string()).min(1),
  sources: z
    .array(
      z.object({
        title: z.string(),
        url: z.url().refine((v) => v.startsWith("https://")),
      }),
    )
    .min(1),
  reviewerId: z.string().min(1),
  reviewedAt: z.iso.datetime(),
  decision: z.literal("approved"),
});
export type ApprovedResult = z.infer<typeof finalResultSchema>;
export const publicResultSchema = finalResultSchema.omit({ reviewerId: true, decision: true });
export type PublicResult = z.infer<typeof publicResultSchema>;
export const publicReceiptSchema = z.discriminatedUnion("status", [
  receiptMetadata.extend({ status: publicRequestStatusSchema.exclude(["Approved"]) }),
  receiptMetadata.extend({ status: z.literal("Approved"), result: publicResultSchema }),
]);
export type PublicReceipt = z.infer<typeof publicReceiptSchema>;
export function validateImage(file: Pick<File, "type" | "size">) {
  if (!["image/jpeg", "image/png", "image/webp"].includes(file.type))
    return "Choose a JPEG, PNG, or WebP image.";
  if (file.size > 10 * 1024 * 1024) return "Image must be 10 MB or smaller.";
  if (!file.size) return "The image is empty.";
  return null;
}
