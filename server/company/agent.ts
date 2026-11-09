import { getModel, getProvider, seesImages } from "../providers/index.ts";
import type { ChatMessage, ImageInput, JsonSchema } from "../providers/types.ts";
import { resilient } from "../net.ts";
import { store } from "../store.ts";
import type { Employee, Project } from "../types.ts";
import { validate } from "./schemas.ts";

export class BudgetExceededError extends Error {}

export interface AgentCall {
  employee: Employee;
  project: Project;
  system: string;
  user: string;
  schemaName: string;
  schema: JsonSchema;
  maxTokens: number;
  effort?: "low" | "medium" | "high";
  /** Screenshots; silently dropped for models that can't see. */
  images?: ImageInput[];
  hint?: Record<string, unknown>;
  signal?: AbortSignal;
}


function extractJson(text: string): unknown {
  const trimmed = text.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    /* fall through */
  }
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced) {
    try {
      return JSON.parse(fenced[1]);
    } catch {
      /* fall through */
    }
  }
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start !== -1 && end > start) return JSON.parse(trimmed.slice(start, end + 1));
  throw new Error("No JSON object found in response");
}

/**
 * Models without strict schema support sometimes drop an empty array field
 * (e.g. "edits": []). Filling those in is cheaper than a retry round-trip.
 */
function fillMissingArrays(value: unknown, schema: JsonSchema): unknown {
  if (schema.type !== "object" || typeof value !== "object" || value === null || Array.isArray(value)) return value;
  const v = value as Record<string, unknown>;
  for (const [k, sub] of Object.entries(schema.properties ?? {})) {
    if (!(k in v) && sub.type === "array") v[k] = [];
    else if (sub.type === "array" && Array.isArray(v[k]) && sub.items) v[k] = (v[k] as unknown[]).map((x) => fillMissingArrays(x, sub.items!));
    else if (sub.type === "object") v[k] = fillMissingArrays(v[k], sub);
  }
  return v;
}

/**
 * One turn of one employee: picks the provider from the employee's model,
 * enforces the project budget, records token usage and cost, and returns a
 * schema-valid object (retrying once with the validation errors if needed).
 */
export async function callAgent<T>(call: AgentCall): Promise<T> {
  const { employee, project } = call;
  const model = getModel(employee.modelKey);
  if (!model) throw new Error(`${employee.name} has no valid model (${employee.modelKey})`);
  const provider = getProvider(model.provider);

  const messages: ChatMessage[] = [{ role: "user", content: call.user }];
  let lastError = "";

  for (let attempt = 0; attempt < 2; attempt++) {
    const budget = store.settings.budgetUsd;
    if (budget > 0 && project.usage.costUsd >= budget) {
      throw new BudgetExceededError(`Project budget of $${budget} reached`);
    }

    // Network drops wait for the provider to come back; other transient errors get backed-off retries.
    // (The Anthropic SDK already retries internally, so it gets fewer extra attempts.)
    const res = await resilient(
      model.provider,
      () =>
        provider.chat({
          model: model.model,
          system: call.system,
          messages,
          maxTokens: call.maxTokens,
          json: { name: call.schemaName, schema: call.schema },
          effort: call.effort,
          images: call.images?.length && seesImages(model) ? call.images : undefined,
          hint: { ...call.hint, lang: store.settings.language, revisions: call.hint?.revisions ?? 0 },
          signal: call.signal,
        }),
      { signal: call.signal, retries: model.provider === "anthropic" ? 1 : 3 },
    );

    // Subscription-backed CLIs are flat-rate: track tokens, but bill nothing per call.
    const cost = model.tags.includes("subscription")
      ? 0
      : (res.inputTokens * model.price.input + res.outputTokens * model.price.output) / 1_000_000;
    for (const u of [employee.stats, project.usage]) {
      u.inputTokens += res.inputTokens;
      u.outputTokens += res.outputTokens;
      u.costUsd += cost;
    }
    employee.stats.calls += 1;
    store.touchCompany();
    store.touchProject(project);

    try {
      const parsed = fillMissingArrays(extractJson(res.text), call.schema);
      const errors = validate(parsed, call.schema);
      if (errors.length === 0) return parsed as T;
      lastError = errors.slice(0, 8).join("; ");
    } catch (err) {
      lastError = (err as Error).message;
    }
    if (res.warning === "max_tokens") {
      lastError += " (your answer was cut off by the output limit: be more concise, e.g. fewer or shorter files)";
    }

    messages.push(
      { role: "assistant", content: res.text || "(empty)" },
      {
        role: "user",
        content: `Your previous answer was not valid: ${lastError}. Reply again with ONLY the corrected JSON object.`,
      },
    );
  }
  throw new Error(`Invalid response from ${model.label}: ${lastError}`);
}
