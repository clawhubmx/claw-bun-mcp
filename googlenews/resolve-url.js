/* @meta
{
  "name": "googlenews/resolve-url",
  "description": "Resolve a Google News RSS/articles redirect URL to the original publisher link via garturlreq batchexecute (or offline decode for legacy encodings).",
  "domain": "news.google.com",
  "args": {
    "url": { "required": true, "description": "Google News redirect URL (news.google.com/rss/articles/... or news.google.com/articles/...)" }
  },
  "capabilities": ["network"],
  "readOnly": true,
  "example": "bun-browser site googlenews/resolve-url \"https://news.google.com/rss/articles/CBMi...?oc=5\""
}
*/

async function (args) {
  function isGoogleNewsHostname(hostname) {
    return hostname === "news.google.com";
  }

  function extractArticleId(urlString) {
    try {
      var parsed = new URL(urlString);
      var match = parsed.pathname.match(/\/(?:rss\/)?(?:articles|read)\/([^/?]+)/);
      return match ? match[1] : "";
    } catch (e) {
      return "";
    }
  }

  function bytesToBinary(bytes) {
    var out = "";
    for (var i = 0; i < bytes.length; i++) out += String.fromCharCode(bytes[i]);
    return out;
  }

  function decodeOffline(articleId) {
    try {
      var str = atob(articleId);
    } catch (e) {
      return null;
    }

    var prefix = bytesToBinary([0x08, 0x13, 0x22]);
    if (str.indexOf(prefix) === 0) str = str.substring(prefix.length);

    var suffix = bytesToBinary([0xd2, 0x01, 0x00]);
    if (str.lastIndexOf(suffix) === str.length - suffix.length) {
      str = str.substring(0, str.length - suffix.length);
    }

    var len = str.charCodeAt(0);
    if (len >= 0x80) {
      str = str.substring(2, len + 2);
    } else {
      str = str.substring(1, len + 1);
    }

    if (!str || str.indexOf("AU_yqL") === 0) return null;
    if (/^https?:\/\//i.test(str)) return str;
    return null;
  }

  function extractAttr(html, attrName) {
    var re = new RegExp(attrName + '="([^"]+)"');
    var match = html.match(re);
    return match ? match[1] : "";
  }

  async function fetchDecodingParams(articleId) {
    var pagePath = "/articles/" + articleId;
    var resp = await fetch(pagePath, { credentials: "include", redirect: "follow" });
    if (!resp.ok) {
      return { error: "HTTP " + resp.status + " fetching article page" };
    }
    var html = await resp.text();
    var signature = extractAttr(html, "data-n-a-sg");
    var timestamp = extractAttr(html, "data-n-a-ts");
    if (!signature || !timestamp) {
      return { error: "Missing decoding params (data-n-a-sg / data-n-a-ts)" };
    }
    return { signature: signature, timestamp: timestamp };
  }

  async function decodeViaBatchexecute(articleId, signature, timestamp) {
    var innerJson = JSON.stringify([
      "garturlreq",
      [
        ["X", "X", ["X", "X"], null, null, 1, 1, "US:en", null, 1, null, null, null, null, null, 0, 1],
        "X",
        "X",
        1,
        [1, 1, 1],
        1,
        1,
        null,
        0,
        0,
        null,
        0,
      ],
      articleId,
      parseInt(timestamp, 10),
      signature,
    ]);

    var payload = JSON.stringify([[["Fbv4je", innerJson, null, "generic"]]]);
    var resp = await fetch("/_/DotsSplashUi/data/batchexecute", {
      method: "POST",
      credentials: "include",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
        "X-Same-Domain": "1",
      },
      body: "f.req=" + encodeURIComponent(payload),
    });

    if (!resp.ok) {
      return { error: "HTTP " + resp.status + " from batchexecute" };
    }

    var text = await resp.text();
    var chunks = text.split("\n\n");
    if (chunks.length < 2) {
      return { error: "Unexpected batchexecute response" };
    }

    var parsed;
    try {
      parsed = JSON.parse(chunks[1]);
    } catch (e) {
      return { error: "Failed to parse batchexecute JSON" };
    }

    if (!parsed[0] || !parsed[0][2]) {
      return { error: "batchexecute returned no payload" };
    }

    var inner;
    try {
      inner = JSON.parse(parsed[0][2]);
    } catch (e) {
      return { error: "Failed to parse garturlres payload" };
    }

    var url = inner && inner[1];
    if (!url || !/^https?:\/\//i.test(url)) {
      return { error: "No publisher URL in batchexecute response" };
    }

    return { url: url };
  }

  if (!args.url) return { error: "Missing argument: url" };

  var raw = String(args.url).trim();
  if (!/^https?:\/\//i.test(raw)) raw = "https://" + raw;

  var hostname;
  try {
    hostname = new URL(raw).hostname;
  } catch (e) {
    return { error: "Invalid url" };
  }

  if (!isGoogleNewsHostname(hostname)) {
    return {
      error: "Not a Google News URL",
      hint: "Use a news.google.com/rss/articles/... or news.google.com/articles/... link.",
      action: "bun-browser open https://news.google.com",
    };
  }

  var articleId = extractArticleId(raw);
  if (!articleId) {
    return {
      error: "Could not extract article id from URL",
      hint: "Expected path like /rss/articles/CBMi... or /articles/CBMi...",
    };
  }

  var offlineUrl = decodeOffline(articleId);
  if (offlineUrl) {
    return {
      googleNewsUrl: raw,
      articleId: articleId,
      url: offlineUrl,
      method: "offline",
    };
  }

  var params = await fetchDecodingParams(articleId);
  if (params.error) {
    return {
      error: params.error,
      hint: "Open news.google.com in Chrome first, then retry.",
      action: "bun-browser open https://news.google.com",
      googleNewsUrl: raw,
      articleId: articleId,
    };
  }

  var decoded = await decodeViaBatchexecute(articleId, params.signature, params.timestamp);
  if (decoded.error) {
    return {
      error: decoded.error,
      hint: "Google News batchexecute decode failed. Open news.google.com in Chrome and retry.",
      action: "bun-browser open https://news.google.com",
      googleNewsUrl: raw,
      articleId: articleId,
    };
  }

  return {
    googleNewsUrl: raw,
    articleId: articleId,
    url: decoded.url,
    method: "batchexecute",
  };
}
