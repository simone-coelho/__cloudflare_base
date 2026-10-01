import type { Core } from './core.js';
export interface IdentifyOptions {
    /** HMAC from the site's backend over tenant, visitorId, accountId and exp (see signAssertion). */
    assertion?: string;
    /** Unix seconds the assertion expires, at most 24 h ahead. */
    exp?: number;
    /** Obtain backend proof for this exact request. Called again after a successful 409 detach. */
    getAssertion?: (claim: {
        tenant: string;
        visitorId: string;
        accountId: string;
    }) => {
        assertion: string;
        exp: number;
    } | Promise<{
        assertion: string;
        exp: number;
    }>;
    /** Where the sign-in happened, for the audit trail: 'login', 'checkout', … */
    source?: string;
}
export type IdentifyResult = {
    ok: true;
    shopperId: string;
    visitorId: string;
    outcome: string | null;
    retried: boolean;
} | {
    ok: false;
    status: number;
    error: string;
    retried: boolean;
};
export interface LogoutResult {
    ok: boolean;
    status: number;
    visitorId: string;
}
export interface Identity {
    identify(accountId: string, options?: IdentifyOptions): Promise<IdentifyResult>;
    logout(): Promise<LogoutResult>;
}
export declare function createIdentity(core: Core): Identity;
