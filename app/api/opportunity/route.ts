import { NextResponse } from "next/server";
import { OpportunityCommandSchema } from "../../../lib/opportunity";
import { understandWithCursor } from "../../../lib/cursor";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const message = typeof body?.message === "string" ? body.message.trim() : "";

    if (!message) {
      return NextResponse.json({ error: "Please enter a prompt." }, { status: 400 });
    }

    if (message.length > 4000) {
      return NextResponse.json(
        { error: "Prompt is too long. Please keep it under 4000 characters." },
        { status: 400 },
      );
    }

    const result = await understandWithCursor(message);
    const validated = OpportunityCommandSchema.safeParse(result.command);

    if (!validated.success) {
      return NextResponse.json(
        { error: "The Cursor response failed opportunity validation." },
        { status: 502 },
      );
    }

    return NextResponse.json({
      command: validated.data,
      meta: {
        provider: "cursor",
        model: result.model ?? "Cursor default model",
        currentDate: new Date().toISOString().slice(0, 10),
        runId: result.runId,
      },
    });
  } catch (error) {
    console.error("Opportunity API error:", error);

    const message = error instanceof Error ? error.message : "Unexpected server error.";

    if (message.includes("CURSOR_API_KEY")) {
      return NextResponse.json(
        { error: "Cursor API is not configured on the server. Add CURSOR_API_KEY in Vercel." },
        { status: 500 },
      );
    }

    if (message.includes("401") || message.includes("403")) {
      return NextResponse.json(
        { error: "Cursor authentication failed. Check the CURSOR_API_KEY configured in Vercel." },
        { status: 502 },
      );
    }

    if (message.includes("timed out")) {
      return NextResponse.json(
        { error: "Cursor took too long to process the request. Please try again." },
        { status: 504 },
      );
    }

    return NextResponse.json(
      { error: "The AI service could not process the request." },
      { status: 502 },
    );
  }
}
