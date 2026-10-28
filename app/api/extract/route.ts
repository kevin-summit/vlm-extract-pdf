import OpenAI from "openai";
import { NextResponse } from "next/server";
import { buildSchema, SYSTEM_PROMPT, type Extraction } from "@/lib/schema";
import { getModels } from "@/lib/models";

export const runtime = "nodejs";
// High-accuracy models can take several minutes on multi-page scans.
export const maxDuration = 800;

// OpenAI accepts up to 50 MB per file input.
const MAX_BYTES = 50 * 1024 * 1024;

export async function POST(req: Request) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "OPENAI_API_KEY is not set. Add it to .env.local and restart the server." },
      { status: 500 },
    );
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "Expected multipart/form-data" }, { status: 400 });
  }

  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Missing 'file' field" }, { status: 400 });
  }
  if (file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) {
    return NextResponse.json({ error: "Only PDF files are supported" }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: "PDF exceeds the 50 MB limit" }, { status: 413 });
  }

  const includeTranscription = form.get("transcribe") === "true";
  const instructions = String(form.get("instructions") ?? "").trim();
  const models = getModels();
  const requested = String(form.get("model") ?? "");
  if (requested && !models.includes(requested)) {
    return NextResponse.json({ error: `Model not allowed: ${requested}` }, { status: 400 });
  }
  const model = requested || models[0];
  const maxOutputTokens = Number(process.env.OPENAI_MAX_OUTPUT_TOKENS) || 128000;

  const base64 = Buffer.from(await file.arrayBuffer()).toString("base64");
  const client = new OpenAI({ apiKey });
  const started = Date.now();

  try {
    const response = await client.responses.create({
      model,
      instructions: SYSTEM_PROMPT,
      input: [
        {
          role: "user",
          content: [
            {
              type: "input_file",
              filename: file.name,
              file_data: `data:application/pdf;base64,${base64}`,
            },
            {
              type: "input_text",
              text:
                "Extract all detailed information from this PDF." +
                (includeTranscription ? " Include a full transcription of every page." : "") +
                (instructions ? `\n\nAdditional instructions from the user:\n${instructions}` : ""),
            },
          ],
        },
      ],
      text: {
        format: {
          type: "json_schema",
          name: "pdf_extraction",
          schema: buildSchema(includeTranscription),
          strict: true,
        },
      },
      max_output_tokens: maxOutputTokens,
    });

    if (response.status === "incomplete") {
      const reason = response.incomplete_details?.reason ?? "unknown";
      return NextResponse.json(
        {
          error:
            reason === "max_output_tokens"
              ? "Output was truncated (document too long). Disable full transcription or raise OPENAI_MAX_OUTPUT_TOKENS."
              : `Model response incomplete: ${reason}`,
        },
        { status: 502 },
      );
    }

    const refusal = response.output
      .flatMap((item) => (item.type === "message" ? item.content : []))
      .find((c) => c.type === "refusal");
    if (refusal) {
      return NextResponse.json({ error: `Model refused: ${refusal.refusal}` }, { status: 422 });
    }

    let data: Extraction;
    try {
      data = JSON.parse(response.output_text) as Extraction;
    } catch {
      return NextResponse.json({ error: "Model returned malformed output. Please retry." }, { status: 502 });
    }
    return NextResponse.json({
      data,
      meta: {
        model: response.model,
        filename: file.name,
        bytes: file.size,
        durationMs: Date.now() - started,
        usage: response.usage ?? null,
      },
    });
  } catch (err) {
    const status = err instanceof OpenAI.APIError && err.status ? err.status : 500;
    const message = err instanceof Error ? err.message : "Extraction failed";
    console.error("[extract]", message);
    return NextResponse.json({ error: message }, { status });
  }
}
