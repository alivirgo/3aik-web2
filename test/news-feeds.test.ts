import { describe, expect, it } from "vitest";
import { FEEDS, MAX_FEED_BYTES } from "../src/news/config";
import { feedsForTick, fetchStories, isFeedContentType, parseFeed, readBodyCapped, sameSiteHost } from "../src/news/feeds";

const now = new Date("2026-10-23T12:00:00.000Z");
const feed = FEEDS[0];

describe("feed parser", () => {
	it("reads an RSS item and prefers the description over encoded content", () => {
		const xml = `<?xml version="1.0"?>
<rss><channel><item>
<title>Vendor posts a short Thursday bulletin</title>
<link>https://www.example.com/story/?utm_source=rss</link>
<pubDate>Thu, 22 Oct 2026 10:00:00 GMT</pubDate>
<description>A vendor posted a short bulletin about a routine maintenance window for its public status page.</description>
<content:encoded>This encoded body is much longer and should not replace a usable description in the excerpt field at all.</content:encoded>
</item></channel></rss>`;
		const stories = parseFeed(xml, feed, now);
		expect(stories).toHaveLength(1);
		expect(stories[0]?.url).toBe("https://example.com/story");
		expect(stories[0]?.excerpt.startsWith("A vendor posted")).toBe(true);
		expect(stories[0]?.excerpt).not.toContain("encoded body");
		expect(stories[0]?.outlet).toBe(feed.outlet);
	});

	it("reads an Atom alternate link and falls through an empty RSS link to the guid", () => {
		const atom = `<?xml version="1.0"?>
<feed><entry>
<title>Atom desk note about a maintenance window</title>
<link rel="self" href="https://example.com/feed"/>
<link rel="alternate" href="https://example.com/atom-story"/>
<summary>The summary is long enough to clear the minimum excerpt length for a usable Atom entry.</summary>
<updated>2026-10-22T10:00:00Z</updated>
</entry></feed>`;
		expect(parseFeed(atom, feed, now)[0]?.url).toBe("https://example.com/atom-story");

		const rss = `<?xml version="1.0"?>
<rss><channel><item>
<title>Guid fallback note about a maintenance window</title>
<link></link>
<guid>https://example.com/from-guid</guid>
<pubDate>Thu, 22 Oct 2026 10:00:00 GMT</pubDate>
<description>The description is long enough to clear the minimum excerpt length for a usable RSS item.</description>
</item></channel></rss>`;
		expect(parseFeed(rss, feed, now)[0]?.url).toBe("https://example.com/from-guid");
	});

	it("drops stale items and excerpts that are too short", () => {
		const xml = `<?xml version="1.0"?>
<rss><channel>
<item>
<title>Old item that should age out of the desk</title>
<link>https://example.com/old</link>
<pubDate>Mon, 01 Jan 2024 10:00:00 GMT</pubDate>
<description>This description is long enough, but the publication date is far outside the desk window.</description>
</item>
<item>
<title>Short item</title>
<link>https://example.com/short</link>
<description>Too short.</description>
</item>
</channel></rss>`;
		expect(parseFeed(xml, feed, now)).toEqual([]);
	});

	it("rotates a six-feed window and skips a failed response", async () => {
		expect(feedsForTick(now)).toHaveLength(6);
		const target = FEEDS[2];
		const xml = `<?xml version="1.0"?><rss><channel><item>
<title>Only the healthy feed should survive</title>
<link>https://example.com/healthy</link>
<pubDate>Thu, 22 Oct 2026 10:00:00 GMT</pubDate>
<description>This description is long enough to clear the minimum excerpt length for the healthy feed.</description>
</item></channel></rss>`;
		const stories = await fetchStories(now, async (input) => {
			const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
			if (url === target.url) return new Response(xml, { status: 200, headers: { "content-type": "application/rss+xml; charset=utf-8" } });
			return new Response("no", { status: 503 });
		}, [target, FEEDS[3]]);
		expect(stories.map((story) => story.url)).toEqual(["https://example.com/healthy"]);
		expect(stories[0]?.outlet).toBe(target.outlet);
	});

	it("drops items that have no publication date", () => {
		const xml = `<?xml version="1.0"?><rss><channel><item>
<title>Undated note about a maintenance window</title>
<link>https://example.com/undated</link>
<description>This description is long enough to clear the minimum excerpt length for an undated item.</description>
</item></channel></rss>`;
		expect(parseFeed(xml, feed, now)).toEqual([]);
	});

	it("accepts feed content types and rejects html", () => {
		expect(isFeedContentType("application/rss+xml; charset=utf-8")).toBe(true);
		expect(isFeedContentType("application/atom+xml")).toBe(true);
		expect(isFeedContentType("text/xml")).toBe(true);
		expect(isFeedContentType("text/html")).toBe(false);
		expect(isFeedContentType(null)).toBe(false);
	});

	it("does not follow a redirect onto another host and caps the body", async () => {
		const stories = await fetchStories(now, async () => new Response(null, {
			status: 302,
			headers: { location: "https://evil.example/rss.xml" },
		}), [feed]);
		expect(stories).toEqual([]);
		expect(sameSiteHost("www.example.com", "example.com")).toBe(true);
		expect(sameSiteHost("example.com", "www.example.com")).toBe(true);
		expect(sameSiteHost("news.example.com", "example.com")).toBe(false);

		const xml = `<?xml version="1.0"?><rss><channel><item>
<title>Redirected bulletin about a maintenance window</title>
<link>https://example.com/redirected</link>
<pubDate>Thu, 22 Oct 2026 10:00:00 GMT</pubDate>
<description>This description is long enough to clear the minimum excerpt length after a same-site redirect.</description>
</item></channel></rss>`;
		const followed = await fetchStories(now, async (input) => {
			const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
			if (url === "https://www.example.com/rss.xml") {
				return new Response(null, { status: 302, headers: { location: "https://example.com/rss.xml" } });
			}
			if (url === "https://example.com/rss.xml") {
				return new Response(xml, { status: 200, headers: { "content-type": "application/rss+xml" } });
			}
			return new Response("no", { status: 404 });
		}, [{ url: "https://www.example.com/rss.xml", outlet: "Example", category: "ai" }]);
		expect(followed.map((story) => story.url)).toEqual(["https://example.com/redirected"]);

		const tooBig = await readBodyCapped(new Response(new Uint8Array(64), {
			headers: { "content-type": "application/rss+xml" },
		}), 16);
		expect(tooBig).toBeNull();
		expect(MAX_FEED_BYTES).toBe(2 * 1024 * 1024);
	});
});
