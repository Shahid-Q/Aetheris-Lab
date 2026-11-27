import { z } from "zod";
import { assessmentSchema, type Evidence, type PreliminaryReport } from "../src/review";
import { readBytes } from "./http";

export interface AIConfig {
  AI_PROVIDER?: string;
  AI_MODEL?: string;
  AGENT_API_KEY?: string;
  AGENT_SYSTEM_PROMPT?: string;
}

export function providerFor(config: AIConfig) {
  const model = config.AI_MODEL?.trim();
  const key = config.AGENT_API_KEY?.trim();
  const instructions = config.AGENT_SYSTEM_PROMPT?.trim();
  if (config.AI_PROVIDER !== "openai" || !model || !/^[\w.:-]{1,128}$/.test(model)
    || !key || !instructions || instructions.length > 8000) return null;

  return {
    name: "openai",
    model,
    async assess(report: PreliminaryReport, evidence: Evidence[]) {
      // The provider receives source data and coded gaps. It cannot call tools or emit prose.
      const response = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: { Authorization: "Bearer " + key, "Content-Type": "application/json" },
        redirect: "manual",
        signal: AbortSignal.timeout(20_000),
        body: JSON.stringify({
          model, store: false, max_completion_tokens: 1800, response_format: { type: "json_object" },
          messages: [
            { role: "system", content: instructions },
            {
              role: "user", content: JSON.stringify({
                responseJSONSchema: z.toJSONSchema(assessmentSchema),
                identities: report.identities, gaps: report.gaps,
                evidence: evidence.map(({ id, kind, solution, title, excerpt }) =>
                  ({ id, kind, solution, title, excerpt: excerpt.slice(0, 600) })),
              })
            },
          ],
        }),
      });
      if (!response.ok) {
        await response.body?.cancel();
        throw new Error("AI_UNAVAILABLE");
      }
      const bytes = await readBytes(response, 32 * 1024);
      if (bytes instanceof Response) throw new Error("AI_UNAVAILABLE");
      const completion = z.object({
        choices: z.tuple([z.object({
          finish_reason: z.literal("stop"),
          message: z.object({ content: z.string(), refusal: z.null().optional() }),
        })]),
      }).parse(JSON.parse(new TextDecoder().decode(bytes)));
      const assessment = assessmentSchema.parse(JSON.parse(completion.choices[0].message.content));
      const kinds = new Map(evidence.map(({ id, kind }) => [id, kind]));
      const bothMatched = report.identities.every(({ state }) => state === "matched");
      if (
        assessment.hazardEvidenceIds.some((id) => kinds.get(id) !== "hazard")
        || assessment.pairConcernEvidenceIds.some((id) => kinds.get(id) !== "incompatibility")
        || (!bothMatched && assessment.pairConcernEvidenceIds.length)
      ) throw new Error("AI_EVIDENCE_MISMATCH");
      return {
        hazardEvidenceIds: [...new Set(assessment.hazardEvidenceIds)],
        pairConcernEvidenceIds: [...new Set(assessment.pairConcernEvidenceIds)],
        uncertainty: [...new Set(assessment.uncertainty)],
      };
    },
  };
}
