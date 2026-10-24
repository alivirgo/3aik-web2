/** Exact loader Ali asked to place in every public HTML head. */
export const ADSENSE_SCRIPT =
	'<script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-7587924838845990" crossorigin="anonymous"></script>';

/**
 * Hosts for script-src, img-src, frame-src, and connect-src.
 * Wildcards follow CSP host matching. The named hosts are listed as well.
 */
export const ADSENSE_HOSTS = [
	"https://pagead2.googlesyndication.com",
	"https://googleads.g.doubleclick.net",
	"https://tpc.googlesyndication.com",
	"https://*.google.com",
	"https://*.gstatic.com",
	"https://adservice.google.com",
	"https://ep1.adtrafficquality.google",
	"https://ep2.adtrafficquality.google",
	"https://fundingchoicesmessages.google.com",
].join(" ");

export const ADS_TXT = "google.com, pub-7587924838845990, DIRECT, f08c47fec0942fa0\n";
