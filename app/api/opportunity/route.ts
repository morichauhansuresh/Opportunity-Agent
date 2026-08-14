import OpenAI from "openai";
import { NextResponse } from "next/server";
import { OpportunityCommandSchema, OPPORTUNITY_SYSTEM_PROMPT } from "../../../lib/opportunity";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const message = typeof body?.message === "string" ? body.message.trim() : "";

    if (!message) {
      return NextResponse.json({ error: "Please enter a prompt." }, { status: 400 });
    }

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { error: "OPENAI_API_KEY is not configured on the server." },
        { status: 500 },
      );
    }

    const model = process.env.OPENAI_MODEL || "gpt-5";
    const currentDate = new Date().toISOString().slice(0, 10);
    const client = new OpenAI({ apiKey });

    const response = await client.responses.create({
      model,
      input: [
        {
          role: "system",
          content: `${OPPORTUNITY_SYSTEM_PROMPT}\n\nCurrent date: ${currentDate}`,
        },
        {
          role: "user",
          content: message,
        },
      ],
    });

    const raw = response.output_text?.trim();
    if (!raw) {
      return NextResponse.json({ error: "The model returned an empty response." }, { status: 502 });
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return NextResponse.json(
        { error: "The model returned invalid JSON.", raw },
        { status: 502 },
      );
    }

    const result = OpportunityCommandSchema.safeParse(parsed);
    if (!result.success) {
      return NextResponse.json(
        { error: "The model response did not match the expected opportunity schema.", raw },
        { status: 502 },
      );
    }

    return NextResponse.json({
      command: result.data,
      meta: {
        model,
        currentDate,
      },
    });
  } catch (error) {
    console.error("Opportunity API error:", error);
    const message = error instanceof Error ? error.message : "Unexpected server error.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
