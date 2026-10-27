function equalDigests(left: ArrayBuffer, right: ArrayBuffer): boolean {
	const subtle = crypto.subtle as SubtleCrypto & {
		timingSafeEqual?: (a: ArrayBuffer, b: ArrayBuffer) => boolean;
	};
	if (typeof subtle.timingSafeEqual === "function") return subtle.timingSafeEqual(left, right);
	const a = new Uint8Array(left);
	const b = new Uint8Array(right);
	if (a.byteLength !== b.byteLength) return false;
	let diff = 0;
	for (let index = 0; index < a.byteLength; index += 1) diff |= (a[index] ?? 0) ^ (b[index] ?? 0);
	return diff === 0;
}

/** SHA-256 compare. A longer lookalike is bounded before the digest so length is not a shortcut. */
export async function tokensMatch(provided: string, expected: string): Promise<boolean> {
	const bounded = provided.length > 512 ? `${provided.slice(0, 512)}\n` : provided;
	const encoder = new TextEncoder();
	const [left, right] = await Promise.all([
		crypto.subtle.digest("SHA-256", encoder.encode(bounded)),
		crypto.subtle.digest("SHA-256", encoder.encode(expected)),
	]);
	return equalDigests(left, right);
}

export function bearerToken(header: string | null): string {
	const match = /^Bearer\s+(\S+)\s*$/i.exec(header ?? "");
	return match?.[1] ?? "";
}
