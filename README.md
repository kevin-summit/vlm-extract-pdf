# VLM PDF Extract

Next.js app that uses an OpenAI vision language model to pull detailed, structured information out of PDF files. It handles digital PDFs, scanned PDFs, tables, forms, handwriting and signatures.

## How it works

1. You upload PDFs in the browser. They are processed two at a time.
2. `POST /api/extract` sends each PDF to the OpenAI **Responses API** as an `input_file`. The model gets both the text layer and an image of every page, so scanned pages are read visually.
3. **Structured Outputs** (strict JSON schema, see `lib/schema.ts`) make the model return:
   document type, title, language, summary, metadata, all key/value fields, entities, every table (cell by cell), sections, visual elements (charts, logos, signatures, stamps, checkboxes), warnings, and optionally a full page-by-page transcription.
4. The results are shown in tabs and can be copied or downloaded as JSON.

## Setup

```bash
npm install
# put your key in .env.local
#   OPENAI_API_KEY=sk-...
npm run dev
```

Open http://localhost:3000.

| Variable | Default | Notes |
| --- | --- | --- |
| `OPENAI_API_KEY` | required | Server-side only. It is never sent to the browser. |
| `OPENAI_MODELS` | `gpt-6.1-sol,gpt-6.1-terra,gpt-5.5` | Models offered in the UI. The first one is the default. The API rejects anything not in this list. |
| `OPENAI_MAX_OUTPUT_TOKENS` | `128000` | Upper bound on output tokens. Dense scans use about 6k output tokens per page. |

## API

```bash
curl -F "file=@doc.pdf" -F "transcribe=true" -F "instructions=Focus on amounts" \
  http://localhost:3000/api/extract
```

## Model choice

Benchmarked on handwritten, scanned anesthesia records (`samples/`):

| Model | Time (2 pages) | Result |
| --- | --- | --- |
| `gpt-6.1-sol` | about 2 min | Most complete. Correct times and checkboxes, captures flowsheet grids, flags uncertain handwriting. |
| `gpt-6.1-terra` | about 1 min | Accurate key fields but captures few tables. |
| `gpt-5.5` | about 2 min | Misreads some handwritten numbers. |
| `gpt-4.1` | about 30 s | Many wrong times, invents checkbox states. Not recommended. |

Every field includes a `confidence` (high/medium/low) and an optional `note` with alternative readings. The UI highlights medium and low fields so they can be checked against the source.

## Limits

- OpenAI limits PDF input to about 50 MB and 100 pages per request.
- Long or dense documents: turn off full transcription if output is truncated. A truncated output returns a clear error.
- **Sensitive data (PHI/PII):** PDFs are sent to OpenAI. For medical records, make sure your organization has a BAA with OpenAI, or a zero-data-retention agreement, before using real patient documents.
