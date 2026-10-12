// src/services/platform.ts
// ---------------------------------------------------------------------------
// The visitor's OS family, read from the request itself, for the `platform`
// seed rule (docs/verizon/Vantage-Demo-Design.md §4, §5).
//
// Two words and nothing finer: `ios` or `android`. The browser's own client
// hint is read first (`Sec-CH-UA-Platform`, which Chromium sends on every
// secure request without being asked), the user agent second (Safari and
// Firefox send no client hints; Chrome on Android still names Android in its
// reduced user agent). A positive answer from either source counts, so a
// desktop hint beside an emulated phone's user agent still reads as the phone.
//
// No model, no version, no high-entropy hint, no fingerprint: the answer is one
// of two words or null. The OS family is read from the request; the fired seed
// (ios or android) is recorded on the receipt as a driver; nothing finer is
// read or kept.
// ---------------------------------------------------------------------------

export type PlatformWord = 'ios' | 'android';

/** The vocabulary a `platform` seed rule may name, exactly. */
export const PLATFORM_WORDS: readonly PlatformWord[] = ['ios', 'android'];

/** The word itself when it is one of the two families, else null. */
export function platformWordOf(value: unknown): PlatformWord | null {
  return value === 'ios' || value === 'android' ? value : null;
}

/** `Sec-CH-UA-Platform` is a structured-header string: `"Android"`, `"iOS"`, `"macOS"`. */
function fromHint(hint: string | null): PlatformWord | null {
  const name = (hint ?? '').trim().replace(/^"(.*)"$/, '$1').trim().toLowerCase();
  return name === 'android' ? 'android' : name === 'ios' ? 'ios' : null;
}

function fromUserAgent(ua: string | null): PlatformWord | null {
  const value = ua ?? '';
  if (/\bAndroid\b/.test(value)) return 'android';
  if (/\b(?:iPhone|iPad|iPod)\b/.test(value)) return 'ios';
  return null;
}

/** The OS family this request reports, or null when it reports neither. */
export function platformOf(headers: Pick<Headers, 'get'>): PlatformWord | null {
  return fromHint(headers.get('Sec-CH-UA-Platform')) ?? fromUserAgent(headers.get('User-Agent'));
}
