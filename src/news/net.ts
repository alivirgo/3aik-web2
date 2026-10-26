const DNS_REBIND_SUFFIXES = [
	".nip.io",
	".sslip.io",
	".xip.io",
	".localtest.me",
	".lvh.me",
	".vcap.me",
	".traefik.me",
];

const BLOCKED_HOSTS = new Set([
	"localhost",
	"metadata",
	"metadata.google.internal",
	"metadata.google.com",
	"instance-data",
	"kubernetes",
	"kubernetes.default",
	"kubernetes.default.svc",
]);

function bareHost(hostname: string): string {
	return hostname.toLowerCase().replace(/\.$/, "").replace(/^\[|\]$/g, "");
}

/** True when a URL host must not be fetched (loopback, private, metadata, or an IP literal). */
export function isBlockedHost(hostname: string): boolean {
	const host = bareHost(hostname);
	if (!host || BLOCKED_HOSTS.has(host)) return true;
	if (host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal") || host.endsWith(".arpa")) return true;
	if (host.endsWith(".cluster.local") || host.endsWith(".localdomain")) return true;
	if (DNS_REBIND_SUFFIXES.some((suffix) => host === suffix.slice(1) || host.endsWith(suffix))) return true;
	if (host.includes(":")) return true;
	if (host.includes("%")) return true;
	if (!/[a-z]/i.test(host)) return true;
	if (/^0x[0-9a-f.]+$/i.test(host)) return true;
	if (/^(?:\d+|0x[0-9a-f]+)(?:\.(?:\d+|0x[0-9a-f]+)){1,3}$/i.test(host)) return true;
	return false;
}

/** https URL with no credentials and a public hostname. Hash is dropped. */
export function publicHttpsUrl(raw: string): string | null {
	let url: URL;
	try {
		url = new URL(raw.trim());
	} catch {
		return null;
	}
	if (url.protocol !== "https:" || url.username || url.password) return null;
	if (isBlockedHost(url.hostname)) return null;
	url.hash = "";
	return url.toString();
}
