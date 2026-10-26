/**
 * Per-isolate token buckets for the collect beacon and human pageview writes.
 * A Cloudflare rate-limit binding is not added here: this worker already binds
 * chat, image, and agent limiters, and a new namespace id is not provisioned
 * on the Free plan from this change. Sharing those limiters would throttle
 * unrelated routes. The bucket is per colo (one isolate), which is the bound
 * the Free plan can enforce without another binding.
 */

interface Bucket {
	tokens: number;
	updated: number;
}

const buckets = new Map<string, Bucket>();

function take(key: string, capacity: number, perMinute: number, now: number): boolean {
	if (buckets.size > 400) {
		const cutoff = now - 120_000;
		for (const [name, bucket] of buckets) {
			if (bucket.updated < cutoff) buckets.delete(name);
		}
	}
	const bucket = buckets.get(key) ?? { tokens: capacity, updated: now };
	const refilled = bucket.tokens + ((now - bucket.updated) * perMinute) / 60_000;
	bucket.tokens = Math.min(capacity, refilled);
	bucket.updated = now;
	if (bucket.tokens < 1) {
		buckets.set(key, bucket);
		return false;
	}
	bucket.tokens -= 1;
	buckets.set(key, bucket);
	return true;
}

/** Beacon writes: 4/min per address key, 10/min for the isolate. */
export function allowCollect(ip: string, now = Date.now()): boolean {
	const key = ip.slice(0, 80) || "anon";
	return take(`c:${key}`, 4, 4, now) && take("c:*", 10, 10, now);
}

/** Human pageview rows: 8/min per address key, 15/min for the isolate. */
export function allowView(ip: string, now = Date.now()): boolean {
	const key = ip.slice(0, 80) || "anon";
	return take(`v:${key}`, 8, 8, now) && take("v:*", 15, 15, now);
}

export function resetRateLimits(): void {
	buckets.clear();
}
