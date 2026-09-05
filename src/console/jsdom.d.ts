// The DOM implementation the console's rendering test runs in. Typed here, minimally, so the
// project's typecheck (no DOM library, no @types/jsdom) accepts the test without another dependency.
declare module 'jsdom' {
  export class JSDOM {
    constructor(html: string, options?: Record<string, unknown>);
    window: Record<string, unknown>;
  }
}
