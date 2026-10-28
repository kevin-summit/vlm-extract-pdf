// JSON schema (OpenAI Structured Outputs, strict mode) describing everything we
// pull out of a PDF. Strict mode requires every property to be listed in
// `required` and `additionalProperties: false`, so optional values are nullable.

export type Confidence = "high" | "medium" | "low";

export type KeyValue = {
  key: string;
  value: string;
  page: number | null;
  confidence: Confidence;
  note: string | null;
};

export type Extraction = {
  document_type: string;
  title: string | null;
  language: string | null;
  summary: string;
  page_count: number;
  metadata: { key: string; value: string }[];
  key_values: KeyValue[];
  entities: { type: string; value: string; context: string | null; page: number | null }[];
  tables: { title: string | null; page: number | null; headers: string[]; rows: string[][] }[];
  sections: { heading: string; page: number | null; content: string }[];
  visual_elements: { type: string; page: number | null; description: string }[];
  pages?: { page_number: number; text: string }[];
  warnings: string[];
};

const str = { type: "string" } as const;
const nullableStr = { type: ["string", "null"] } as const;
const nullablePage = { type: ["integer", "null"], description: "1-based page number" } as const;

function obj(properties: Record<string, unknown>) {
  return {
    type: "object",
    additionalProperties: false,
    properties,
    required: Object.keys(properties),
  };
}

export function buildSchema(includeTranscription: boolean) {
  const properties: Record<string, unknown> = {
    document_type: { ...str, description: "e.g. invoice, contract, bank statement, resume, report, form" },
    title: nullableStr,
    language: { ...nullableStr, description: "ISO 639-1 code of the main language" },
    summary: { ...str, description: "Concise but complete summary of the document's purpose and content" },
    page_count: { type: "integer" },
    metadata: {
      type: "array",
      description: "Document-level facts: author, issuer, recipient, dates, reference numbers, version, etc.",
      items: obj({ key: str, value: str }),
    },
    key_values: {
      type: "array",
      description: "Every labeled field / form field and its value, exactly as written",
      items: obj({
        key: str,
        value: { ...str, description: "Verbatim value only; empty string if the field is blank. No editorial notes here." },
        page: nullablePage,
        confidence: {
          type: "string",
          enum: ["high", "medium", "low"],
          description: "high = clearly legible; medium = probable reading; low = guess or largely illegible",
        },
        note: { ...nullableStr, description: "Alternative readings or why the value is uncertain" },
      }),
    },
    entities: {
      type: "array",
      description: "Named entities: person, organization, address, email, phone, date, money, id_number, product, location, url",
      items: obj({ type: str, value: str, context: nullableStr, page: nullablePage }),
    },
    tables: {
      type: "array",
      description: "Every table (including line items), cell values verbatim. Each row has the same length as headers.",
      items: obj({
        title: nullableStr,
        page: nullablePage,
        headers: { type: "array", items: str },
        rows: { type: "array", items: { type: "array", items: str } },
      }),
    },
    sections: {
      type: "array",
      description: "Logical sections / clauses with their content",
      items: obj({ heading: str, page: nullablePage, content: str }),
    },
    visual_elements: {
      type: "array",
      description: "Charts, diagrams, photos, logos, signatures, stamps, handwriting, checkboxes, barcodes/QR codes",
      items: obj({ type: str, page: nullablePage, description: str }),
    },
    warnings: {
      type: "array",
      description: "Illegible areas, uncertain readings, truncated content",
      items: str,
    },
  };

  if (includeTranscription) {
    properties.pages = {
      type: "array",
      description: "Faithful full-text transcription of every page, in reading order (markdown allowed)",
      items: obj({ page_number: { type: "integer" }, text: str }),
    };
  }

  return obj(properties);
}

export const SYSTEM_PROMPT = `You are an expert document-understanding system with vision.
You receive a PDF (both its text layer and rendered page images). Extract ALL information it contains, completely and accurately.

Rules:
- Read every page, including headers, footers, footnotes, margins, stamps, handwriting and small print.
- Use the page images: scanned pages may have no text layer; read them visually (OCR).
- Copy values verbatim (numbers, dates, IDs, currency symbols, spelling). Do not normalize or invent anything.
- Capture every table cell; keep row/column alignment. Merge tables that continue across pages.
- Checkboxes / circled options: report each option as a field with value "checked" or "unchecked". Only report "checked" when a mark is actually visible; never infer.
- Signatures: say whether present and any legible printed name/date. Do not invent names.
- Flowsheets / time-series grids (vitals, doses, readings): output a table with one column per time point and one row per parameter.
- Never guess silently. Give your best reading, set confidence to medium/low, and put alternatives in note (e.g. "1142 or 1147").
- In transcriptions write [illegible] for unreadable text and append [?] to uncertain readings.
- Blank fields: empty string. Use null only when a value is genuinely absent from the document.`;
