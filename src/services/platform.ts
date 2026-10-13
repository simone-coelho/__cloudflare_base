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

// ---------------------------------------------------------------------------
// P37 (decision D1): the device class, read from the same request.
//
// Two words: `mobile` or `desktop`; a tablet counts as desktop until the
// customer says otherwise. The browser's own client hint is read first
// (`Sec-CH-UA-Mobile`, a structured-header boolean Chromium sends on every
// secure request: `?1` a mobile device, `?0` not), the user agent second (Safari
// and Firefox send no client hints). From the user agent a phone reads as mobile
// — an iPhone or iPod, an Android user agent carrying the `Mobile` token, any
// other user agent carrying `Mobi` — and a tablet (an iPad, an Android user agent
// without `Mobile`, a `Tablet` token) and every other browser as desktop. A
// request carrying neither the hint nor a browser's user agent has no device:
// a client that names no browser (a server-side caller, a script) is not
// evidence of a desktop, and an absent device is never guessed.
//
// Nothing finer is read or kept: no model, no vendor, no version, no
// high-entropy hint and never the user agent itself. The class is first-paint
// context: recorded on the visit that the request opens, read by a decision for
// the request it serves, a seed-signal key a rule may name and a term a
// configured order's context may name.
// ---------------------------------------------------------------------------

export type DeviceClass = 'mobile' | 'desktop';

/** The vocabulary a `device` seed rule or a configured order's context may name, exactly. */
export const DEVICE_CLASSES: readonly DeviceClass[] = ['mobile', 'desktop'];

/** The class itself when it is one of the two, else null. */
export function deviceClassOf(value: unknown): DeviceClass | null {
  return value === 'mobile' || value === 'desktop' ? value : null;
}

/** `Sec-CH-UA-Mobile` is a structured-header boolean: `?1` or `?0`; anything else is no answer. */
function deviceFromHint(hint: string | null): DeviceClass | null {
  const value = (hint ?? '').trim();
  return value === '?1' ? 'mobile' : value === '?0' ? 'desktop' : null;
}

function deviceFromUserAgent(ua: string | null): DeviceClass | null {
  const value = (ua ?? '').trim();
  // A browser names itself with the historical `Mozilla/` product token (every
  // engine in use does); anything else names no browser and so no device.
  if (!/^Mozilla\//.test(value)) return null;
  // A tablet first: an iPad's user agent carries `Mobile/` in its build token,
  // so a bare mobile test would misread it.
  if (/\biPad\b/.test(value) || /\bTablet\b/.test(value)) return 'desktop';
  if (/\b(?:iPhone|iPod)\b/.test(value)) return 'mobile';
  if (/\bAndroid\b/.test(value)) return /\bMobile\b/.test(value) ? 'mobile' : 'desktop';
  return /Mobi/.test(value) ? 'mobile' : 'desktop';
}

/** The device class this request reports, or null when it reports none. */
export function deviceOf(headers: Pick<Headers, 'get'>): DeviceClass | null {
  return deviceFromHint(headers.get('Sec-CH-UA-Mobile')) ?? deviceFromUserAgent(headers.get('User-Agent'));
}
