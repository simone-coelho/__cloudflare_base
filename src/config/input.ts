// HTTP/import admission budgets, not a supported catalog or runtime capacity.
export const INPUT_MAX_BYTES = 2 * 1024 * 1024;
export const INPUT_MAX_RECORDS = 10_000;
const encoder = new TextEncoder();

export class InputError extends Error {
  readonly code: 'input_budget_exceeded' | 'input_unreadable';
  constructor(readonly status: 400 | 413, readonly budget?: string, readonly limit?: number, readonly observed?: number) {
    super(status === 413 ? 'Input exceeds the application safety limit' : 'Input stream could not be read');
    this.code = status === 413 ? 'input_budget_exceeded' : 'input_unreadable';
  }
}
export function inputLimit(budget: string, observed: number, limit: number): void {
  if (observed > limit) throw new InputError(413, budget, limit, observed);
}
export function inputRecords(value: unknown): void {
  if (Array.isArray(value)) inputLimit('records', value.length, INPUT_MAX_RECORDS);
}
export function inputTextBytes(text: string): void {
  inputLimit('text_code_units', text.length, INPUT_MAX_BYTES);
  inputLimit('bytes', encoder.encode(text).byteLength, INPUT_MAX_BYTES);
}

/** Ignore Content-Length: count delivered bytes before copying, then decode as HTTP text does. */
export async function readInputText(stream: ReadableStream<Uint8Array> | null): Promise<string> {
  if (stream === null) return '';
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  let complete = false;
  try {
    reader = stream.getReader();
    let buffer = new Uint8Array(4096), bytes = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) { complete = true; break; }
      if (!(value instanceof Uint8Array)) throw new InputError(400);
      const next = bytes + value.byteLength;
      inputLimit('bytes', next, INPUT_MAX_BYTES);
      if (next > buffer.length) {
        const grown = new Uint8Array(Math.min(INPUT_MAX_BYTES, Math.max(next, buffer.length * 2)));
        grown.set(buffer.subarray(0, bytes)); buffer = grown;
      }
      buffer.set(value, bytes); bytes = next;
    }
    return new TextDecoder('utf-8', { fatal: false, ignoreBOM: false }).decode(buffer.subarray(0, bytes));
  } catch (error) {
    if (error instanceof InputError) throw error;
    throw new InputError(400);
  } finally {
    if (reader) {
      if (!complete) void reader.cancel().catch(() => undefined);
      reader.releaseLock();
    }
  }
}

/** Only malformed JSON falls back; a failed/oversized stream must never become an empty mutation. */
export async function readInputJson(stream: ReadableStream<Uint8Array> | null, fallback: unknown = null): Promise<unknown> {
  const text = await readInputText(stream);
  try { return JSON.parse(text); } catch { return fallback; }
}
