/** Raw reader events. Analytics Engine is on the Workers Free plan (100,000 points/day). */
export function writeNewsEvent(
	dataset: AnalyticsEngineDataset | undefined,
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
	if (!dataset) return;
	if (sampled && !sampleTick()) return;
	const clip = (value: string) => value.replace(/[\r\n]/g, " ").slice(0, 256);
	dataset.writeDataPoint({
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
