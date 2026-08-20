import { OpportunityCommandSchema, type OpportunityCommand } from "./opportunity";

const CURSOR_API_BASE = "https://api.cursor.com/v1";
const POLL_INTERVAL_MS = 1000;
const MAX_POLL_ATTEMPTS = 30;

function getAuthHeader(apiKey: string): string {
  const encoded = Buffer.from(`${apiKey}:`).toString("base64");
  return `Basic ${encoded}`;
}

async function cursorRequest(
  path: string,
  init: RequestInit,
  apiKey: string,
): Promise<Response> {
  return fetch(`${CURSOR_API_BASE}${path}`, {
    ...init,
    headers: {
      Authorization: getAuthHeader(apiKey),
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
    cache: "no-store",
  });
}

function extractJson(text: string): unknown {
  const trimmed = text.trim();

  try {
    return JSON.parse(trimmed);
  } catch {
    // Continue with fenced JSON / embedded JSON extraction.
  }

  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fenced?.[1]) {
    return JSON.parse(fenced[1]);
  }

  const firstBrace = trimmed.indexOf("{");
  const lastBrace = trimmed.lastIndexOf("}");

  if (firstBrace >= 0 && lastBrace > firstBrace) {
    return JSON.parse(trimmed.slice(firstBrace, lastBrace + 1));
  }

  throw new Error("Cursor did not return a JSON object.");
}

export async function understandWithCursor(
  userMessage: string,
): Promise<{ command: OpportunityCommand; model?: string; runId: string }> {
  const apiKey = process.env.CURSOR_API_KEY;

  if (!apiKey) {
    throw new Error("CURSOR_API_KEY is not configured on the server.");
  }

  const currentDate = new Date().toISOString().slice(0, 10);

  const prompt = `
You are the Opportunity Agent for Microsoft Dynamics CRM.

Your ONLY job is to transform the user's request into ONE JSON object.
Do not perform any CRM operation.
Do not discuss your reasoning.
Do not use markdown.
Return ONLY valid JSON.

Supported actions:
- CREATE_OPPORTUNITY
- SEARCH_OPPORTUNITIES
- GET_OPPORTUNITY
- UPDATE_OPPORTUNITY

Rules:
1. Never invent values the user did not provide.
2. Convert amounts such as 50K, 50,000, $50K, 2 million into numeric values.
3. Convert natural-language dates into YYYY-MM-DD using the current date as reference.
4. If a value is missing or cannot be determined, return null.
5. Infer the most appropriate action from the request.
6. For CREATE_OPPORTUNITY, capture account, opportunity/topic, amount, currency, close date, and description when provided.
7. For SEARCH_OPPORTUNITIES, capture whatever search criteria can fit the fixed schema fields.
8. For UPDATE_OPPORTUNITY, capture the account/opportunity and the fields being updated.

Current date: ${currentDate}

The JSON shape MUST be exactly:
{
  "action": "CREATE_OPPORTUNITY | SEARCH_OPPORTUNITIES | GET_OPPORTUNITY | UPDATE_OPPORTUNITY",
  "accountName": string | null,
  "opportunityName": string | null,
  "estimatedValue": number | null,
  "currency": string | null,
  "closeDate": string | null,
  "description": string | null
}

USER REQUEST:
${userMessage}
`;

  const createResponse = await cursorRequest(
    "/agents",
    {
      method: "POST",
      body: JSON.stringify({
        prompt: { text: prompt },
        name: "Opportunity Agent JSON Parser",
      }),
    },
    apiKey,
  );

  if (!createResponse.ok) {
    const details = await createResponse.text();
    throw new Error(
      `Cursor API error while creating the agent (${createResponse.status}): ${details}`,
    );
  }

  const created = (await createResponse.json()) as {
    agent?: { id?: string };
    run?: { id?: string };
  };

  const agentId = created.agent?.id;
  const runId = created.run?.id;

  if (!agentId || !runId) {
    throw new Error("Cursor did not return an agent ID and run ID.");
  }

  for (let attempt = 0; attempt < MAX_POLL_ATTEMPTS; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));

    const runResponse = await cursorRequest(
      `/agents/${encodeURIComponent(agentId)}/runs/${encodeURIComponent(runId)}`,
      { method: "GET" },
      apiKey,
    );

    if (!runResponse.ok) {
      const details = await runResponse.text();
      throw new Error(
        `Cursor API error while reading the run (${runResponse.status}): ${details}`,
      );
    }

    const run = (await runResponse.json()) as {
      status?: string;
      result?: string;
      error?: string;
      model?: string;
    };

    if (["FINISHED", "COMPLETED", "SUCCEEDED"].includes(run.status ?? "")) {
      const rawResult = run.result?.trim();

      if (!rawResult) {
        throw new Error("Cursor completed the run but returned no result.");
      }

      let parsed: unknown;

      try {
        parsed = extractJson(rawResult);
      } catch {
        throw new Error(`Cursor returned a non-JSON result: ${rawResult}`);
      }

      const validated = OpportunityCommandSchema.safeParse(parsed);

      if (!validated.success) {
        throw new Error(
          `Cursor returned JSON that does not match the opportunity schema: ${validated.error.message}`,
        );
      }

      return {
        command: validated.data,
        model: run.model,
        runId,
      };
    }

    if (["FAILED", "ERROR", "CANCELLED", "CANCELED"].includes(run.status ?? "")) {
      throw new Error(
        `Cursor agent run ${run.status?.toLowerCase() ?? "failed"}${run.error ? `: ${run.error}` : "."}`,
      );
    }
  }

  throw new Error("Cursor agent timed out while processing the request.");
}
