import { ADSENSE_HOSTS } from "../adsense";
import { renderNotFound } from "./html";

/**
 * Public HTML is edge-cached. Inline scripts use CSP hashes, not nonces,
 * so the document is stable for a URL. `publicNotFoundResponse` is the only
 * 404 used for a normal miss and for a hidden stats or collect miss.
 */
export async function scriptSourceHash(source: string): Promise<string> {
	const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(source));
	let binary = "";
	for (const byte of new Uint8Array(digest)) binary += String.fromCharCode(byte);
	return `'sha256-${btoa(binary)}'`;
}

/** Hashes of sources this worker wrote: JSON-LD bodies and the collect beacon. Nothing else. */
export async function scriptSourceHashes(sources: string[]): Promise<string[]> {
	const hashes: string[] = [];
	for (const source of sources) {
		if (source) hashes.push(await scriptSourceHash(source));
	}
	return hashes;
}

export function htmlCsp(hashes: string[]): string {
	const inline = hashes.length ? ` ${hashes.join(" ")}` : "";
	return `default-src 'self'; base-uri 'self'; connect-src 'self' ${ADSENSE_HOSTS}; font-src 'self'; form-action 'none'; frame-ancestors 'none'; frame-src ${ADSENSE_HOSTS}; img-src 'self' ${ADSENSE_HOSTS}; object-src 'none'; script-src ${ADSENSE_HOSTS}${inline}; style-src 'self'; upgrade-insecure-requests`;
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

export async function publicNotFoundResponse(request: Request, origin: string): Promise<Response> {
	const page = renderNotFound(origin);
	const headers = securityHeaders("text/html; charset=utf-8", "no-store", htmlCsp(await scriptSourceHashes(page.scripts)));
	if (request.method === "HEAD") return new Response(null, { status: 404, headers });
	return new Response(page.html, { status: 404, headers });
}
