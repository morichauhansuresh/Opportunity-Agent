import { OpportunityCommandSchema, type OpportunityCommand } from "./opportunity";

const CURSOR_API_BASE = "https://api.cursor.com/v1";
const STREAM_TIMEOUT_MS = 90_000;

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
      Accept: "application/json",
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

export class CursorApiError extends Error {
  readonly status?: number;
  readonly code?: string;

  constructor(message: string, options?: { status?: number; code?: string }) {
    super(message);
    this.name = "CursorApiError";
    this.status = options?.status;
    this.code = options?.code;
  }
}

async function readCursorError(response: Response): Promise<string> {
  try {
    const text = await response.text();
    if (!text) return response.statusText || "Unknown Cursor API error.";

    try {
      const payload = JSON.parse(text) as {
        error?: { code?: string; message?: string } | string;
        message?: string;
      };

      if (typeof payload.error === "string") return payload.error;
      if (payload.error?.message) {
        return payload.error.code
          ? `${payload.error.code}: ${payload.error.message}`
          : payload.error.message;
      }
      if (payload.message) return payload.message;
    } catch {
      // Fall through to raw text.
    }

    return text.slice(0, 1200);
  } catch {
    return response.statusText || "Unknown Cursor API error.";
  }
}

type StreamResult = {
  text?: string;
  model?: string;
  error?: { code?: string; message?: string };
};

async function streamCursorRun(
  agentId: string,
  runId: string,
  apiKey: string,
): Promise<StreamResult> {
  const response = await cursorRequest(
    `/agents/${encodeURIComponent(agentId)}/runs/${encodeURIComponent(runId)}/stream`,
    {
      method: "GET",
      headers: {
        Accept: "text/event-stream",
      },
    },
    apiKey,
  );

  if (!response.ok) {
    const details = await readCursorError(response);
    throw new CursorApiError(
      `Cursor stream request failed (${response.status}): ${details}`,
      { status: response.status },
    );
  }

  if (!response.body) {
    throw new CursorApiError("Cursor returned an empty stream response.");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let currentEvent = "message";
  let currentData: string[] = [];
  let resultText: string | undefined;
  let model: string | undefined;
  let error: { code?: string; message?: string } | undefined;

  const processEvent = () => {
    if (currentData.length === 0) return;

    const raw = currentData.join("\n").trim();
    currentEvent = currentEvent || "message";
    currentData = [];

    if (!raw) return;

    let data: Record<string, unknown>;
    try {
      data = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      currentEvent = "message";
      return;
    }

    if (currentEvent === "result") {
      resultText = typeof data.text === "string" ? data.text : undefined;
      model = typeof data.model === "string" ? data.model : undefined;
    }

    if (currentEvent === "error") {
      error = {
        code: typeof data.code === "string" ? data.code : undefined,
        message: typeof data.message === "string" ? data.message : undefined,
      };
    }

    currentEvent = "message";
  };

  const timeoutId = setTimeout(() => {
    void reader.cancel();
  }, STREAM_TIMEOUT_MS);

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        if (line === "") {
          processEvent();
          continue;
        }

        if (line.startsWith("event:")) {
          currentEvent = line.slice("event:".length).trim() || "message";
          continue;
        }

        if (line.startsWith("data:")) {
          currentData.push(line.slice("data:".length).trimStart());
        }
      }

      if (error || resultText) {
        // The terminal result/error event is enough for this request.
        // The stream itself will close shortly; stop here to keep latency low.
        break;
      }
    }

    if (buffer.trim() && buffer.startsWith("data:")) {
      currentData.push(buffer.slice("data:".length).trimStart());
      processEvent();
    }
  } finally {
    clearTimeout(timeoutId);
    await reader.cancel().catch(() => undefined);
  }

  if (!error && !resultText) {
    throw new CursorApiError(
      "Cursor stream ended without a result or error event. Check Cursor Cloud Agent status for this run.",
    );
  }

  return { text: resultText, model, error };
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
        autoCreatePR: false,
      }),
    },
    apiKey,
  );

  if (!createResponse.ok) {
    const details = await readCursorError(createResponse);
    throw new CursorApiError(
      `Cursor API error while creating the agent (${createResponse.status}): ${details}`,
      { status: createResponse.status },
    );
  }

  const created = (await createResponse.json()) as {
    agent?: { id?: string };
    run?: { id?: string };
  };

  const agentId = created.agent?.id;
  const runId = created.run?.id;

  if (!agentId || !runId) {
    throw new CursorApiError("Cursor did not return an agent ID and run ID.");
  }

  const stream = await streamCursorRun(agentId, runId, apiKey);

  if (stream.error) {
    const details = stream.error.code
      ? `${stream.error.code}: ${stream.error.message ?? "Cursor agent run failed."}`
      : stream.error.message ?? "Cursor agent run failed.";

    throw new CursorApiError(details, { code: stream.error.code });
  }

  const rawResult = stream.text?.trim();
  if (!rawResult) {
    throw new CursorApiError("Cursor completed without returning a result.");
  }

  let parsed: unknown;
  try {
    parsed = extractJson(rawResult);
  } catch {
    throw new CursorApiError(`Cursor returned a non-JSON result: ${rawResult.slice(0, 1200)}`);
  }

  const validated = OpportunityCommandSchema.safeParse(parsed);

  if (!validated.success) {
    throw new CursorApiError(
      `Cursor returned JSON that does not match the opportunity schema: ${validated.error.message}`,
    );
  }

  return {
    command: validated.data,
    model: stream.model,
    runId,
  };
}
