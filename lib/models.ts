// Server-side model configuration. The first entry of OPENAI_MODELS is the default.
// Defaults were chosen by benchmarking on handwritten scanned forms:
//   gpt-6.1-sol   - most complete and accurate (slowest)
//   gpt-6.1-terra - ~2x faster, captures fewer tables
//   gpt-5.5       - older, misreads more handwriting
export function getModels(): string[] {
  const list = (process.env.OPENAI_MODELS || "gpt-6.1-sol,gpt-6.1-terra,gpt-5.5")
    .split(",")
    .map((m) => m.trim())
    .filter(Boolean);
  const legacy = process.env.OPENAI_MODEL?.trim();
  return legacy && !list.includes(legacy) ? [legacy, ...list] : list;
}
