import { ADSENSE_HOSTS } from "../adsense";
import { renderNotFound } from "./html";

/**
 * HTML documents carry a per-response nonce. They are not edge-cached.
 * `publicNotFoundResponse` is the only 404 used for a normal miss and for a
 * hidden stats or collect miss, so those responses share one header set.
 */
export function freshNonce(): string {
	const bytes = new Uint8Array(16);
	crypto.getRandomValues(bytes);
	return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function htmlCsp(imageOrigins: string[], nonce: string): string {
	const extra = imageOrigins.length ? ` ${imageOrigins.join(" ")}` : "";
	return `default-src 'self'; base-uri 'self'; connect-src 'self' ${ADSENSE_HOSTS}; font-src 'self'; form-action 'none'; frame-ancestors 'none'; frame-src ${ADSENSE_HOSTS}; img-src 'self' ${ADSENSE_HOSTS}${extra}; object-src 'none'; script-src ${ADSENSE_HOSTS} 'nonce-${nonce}'; style-src 'self'; upgrade-insecure-requests`;
}

export function securityHeaders(contentType: string, cache: string, csp: string): Headers {
	const headers = new Headers();
	headers.set("content-type", contentType);
	headers.set("cache-control", cache);
	headers.set("x-content-type-options", "nosniff");
	headers.set("x-frame-options", "DENY");
	headers.set("referrer-policy", "strict-origin-when-cross-origin");
	headers.set("strict-transport-security", "max-age=31536000");
	headers.set("permissions-policy", "camera=(), microphone=(), geolocation=(), payment=(), usb=()");
	headers.set("content-security-policy", csp);
	return headers;
}

export function publicNotFoundResponse(request: Request, origin: string): Response {
	const headers = securityHeaders("text/html; charset=utf-8", "no-store", htmlCsp([], freshNonce()));
	if (request.method === "HEAD") return new Response(null, { status: 404, headers });
	return new Response(renderNotFound(origin), { status: 404, headers });
}
