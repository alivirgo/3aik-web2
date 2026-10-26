/**
 * Optional raw points. The binding is absent until Analytics Engine deploys on
 * this account. D1 rollups stay the source of truth either way.
 */
export function writeNewsEvent(
	env: { AI_NEWS_EVENTS?: AnalyticsEngineDataset },
	event: {
		kind: string;
		slug: string;
		host: string;
		country: string;
		device: string;
		botName: string;
		engagedMs: number;
		scrollPct: number;
	},
	sampled: boolean,
): void {
	if (!env.AI_NEWS_EVENTS) return;
	if (sampled && !sampleTick()) return;
	const clip = (value: string) => value.replace(/[\r\n]/g, " ").slice(0, 256);
	env.AI_NEWS_EVENTS?.writeDataPoint({
		indexes: [clip(event.slug || event.kind || "news").slice(0, 96)],
		blobs: [event.kind, event.slug, event.host, event.country, event.device, event.botName].map(clip),
		doubles: [event.engagedMs, event.scrollPct],
	});
}

let dropped = 0;

function sampleTick(): boolean {
	dropped += 1;
	return dropped % 20 === 0;
}

export function resetEventSample(): void {
	dropped = 0;
}
