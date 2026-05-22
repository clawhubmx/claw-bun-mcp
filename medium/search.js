/* @meta
{
  "name": "medium/search",
  "description": "Medium 站内搜索 (search: query, results with title, url, excerpt)",
  "domain": "medium.com",
  "args": {
    "query": { "required": true, "description": "Search keywords" },
    "count": { "required": false, "description": "Max results (default 15, max 30)" }
  },
  "capabilities": ["network", "search"],
  "readOnly": true,
  "example": "bun-browser site medium/search \"typescript graphql\""
}
*/

async function (args) {
  function isMediumStoryUrl(href) {
    try {
      var u = new URL(href);
      var host = u.hostname;
      if (host !== "medium.com" && !host.endsWith(".medium.com")) return false;
      var p = u.pathname;
      if (/\/search|\/topics\/|\/tag\/|\/membership|\/m\/signin|\/new-story|\/cdn-cgi/i.test(p)) return false;
      if (/\/p\/[a-f0-9]{8,}/i.test(p)) return true;
      if (/\/@[^/]+\/[^/]+/.test(p)) return true;
      return false;
    } catch (e) {
      return false;
    }
  }

  function extractFromNextData(data, limit) {
    var out = [];
    function push(url, title, excerpt) {
      for (var i = 0; i < out.length; i++) {
        if (out[i].url === url) return;
      }
      out.push({
        title: title,
        url: url,
        excerpt: typeof excerpt === "string" ? excerpt.replace(/\s+/g, " ").trim() : "",
      });
    }
    function walk(obj, depth) {
      if (depth > 25 || out.length >= limit) return;
      if (!obj || typeof obj !== "object") return;

      if (typeof obj.mediumUrl === "string" && typeof obj.title === "string") {
        var u = obj.mediumUrl.indexOf("http") === 0 ? obj.mediumUrl : "https://medium.com" + obj.mediumUrl;
        push(u, obj.title, obj.subtitle || obj.description || "");
        return;
      }

      if (obj.uniqueSlug && obj.title && obj.user && obj.user.username) {
        var u2 = "https://medium.com/@" + obj.user.username + "/" + obj.uniqueSlug;
        push(u2, String(obj.title), obj.subtitle ? String(obj.subtitle) : "");
        return;
      }

      if (Array.isArray(obj)) {
        for (var i = 0; i < obj.length; i++) walk(obj[i], depth + 1);
        return;
      }
      var keys = Object.keys(obj);
      for (var k = 0; k < keys.length; k++) walk(obj[keys[k]], depth + 1);
    }

    walk(data, 0);
    return out;
  }

  function extractFromAnchors(doc, limit) {
    var seen = {};
    var out = [];
    var links = doc.querySelectorAll("a[href]");
    for (var i = 0; i < links.length && out.length < limit; i++) {
      var href = links[i].getAttribute("href") || "";
      if (href.indexOf("/") === 0) href = "https://medium.com" + href;
      if (href.indexOf("http") !== 0) continue;
      if (!isMediumStoryUrl(href)) continue;
      if (seen[href]) continue;
      var title = (links[i].textContent || "").replace(/\s+/g, " ").trim();
      if (title.length < 3) continue;
      seen[href] = true;
      out.push({ title: title, url: href, excerpt: "" });
    }
    return out;
  }

  if (!args.query) return { error: "Missing argument: query" };

  var q = String(args.query);
  var count = Math.min(parseInt(String(args.count || "15"), 10) || 15, 30);
  var url = "https://medium.com/search?q=" + encodeURIComponent(q);

  var resp = await fetch(url, { credentials: "include" });
  if (!resp.ok) {
    return {
      error: "HTTP " + resp.status,
      hint: "请在 Chrome 中登录 medium.com 后重试。",
      action: "bun-browser open https://medium.com",
    };
  }

  var html = await resp.text();
  var doc = new DOMParser().parseFromString(html, "text/html");

  var nd = doc.getElementById("__NEXT_DATA__");
  if (nd && nd.textContent) {
    try {
      var data = JSON.parse(nd.textContent);
      var fromNext = extractFromNextData(data, count);
      if (fromNext.length > 0) {
        return {
          query: q,
          count: fromNext.length,
          results: fromNext,
        };
      }
    } catch (e) {}
  }

  var fallback = extractFromAnchors(doc, count);
  if (fallback.length === 0) {
    return {
      error: "Could not parse search results",
      hint: "Medium 搜索页或 Next 数据格式可能已变更；可用 bun-browser network requests --with-body 抓包后改为直调 API。",
      action: "bun-browser open " + url,
    };
  }

  return {
    query: q,
    count: fallback.length,
    results: fallback,
  };
}
