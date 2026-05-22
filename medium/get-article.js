/* @meta
{
  "name": "medium/get-article",
  "description": "读取 Medium 文章正文与元数据 (get article: title, author, publishedAt, articleBody, url)",
  "domain": "medium.com",
  "args": {
    "url": { "required": true, "description": "Medium post URL (medium.com or *.medium.com)" }
  },
  "capabilities": ["network"],
  "readOnly": true,
  "example": "bun-browser site medium/get-article https://medium.com/@user/some-post-slug"
}
*/

async function (args) {
  function flattenLd(node) {
    if (!node) return [];
    if (Array.isArray(node)) {
      var acc = [];
      for (var i = 0; i < node.length; i++) acc = acc.concat(flattenLd(node[i]));
      return acc;
    }
    if (node["@graph"]) return flattenLd(node["@graph"]);
    return [node];
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

  if (hostname !== "medium.com" && !hostname.endsWith(".medium.com")) {
    return {
      error: "Not a Medium URL",
      hint: "使用 medium.com 或 *.medium.com 下的文章链接。",
      action: "bun-browser open https://medium.com",
    };
  }

  var resp = await fetch(raw, { credentials: "include", redirect: "follow" });
  if (!resp.ok) {
    return {
      error: "HTTP " + resp.status,
      hint: "文章可能已删除、需要会员或当前未登录。",
      action: "bun-browser open " + raw,
    };
  }

  var html = await resp.text();
  var doc = new DOMParser().parseFromString(html, "text/html");

  var title = "";
  var authorName = "";
  var publishedAt = "";
  var description = "";
  var articleBody = "";

  var scripts = doc.querySelectorAll('script[type="application/ld+json"]');
  for (var s = 0; s < scripts.length; s++) {
    try {
      var j = JSON.parse(scripts[s].textContent || "{}");
      var items = flattenLd(j);
      for (var i = 0; i < items.length; i++) {
        var item = items[i];
        if (!item || typeof item !== "object") continue;
        var t = item["@type"];
        var types = Array.isArray(t) ? t : [t];
        var isArticle = false;
        for (var k = 0; k < types.length; k++) {
          if (types[k] === "BlogPosting" || types[k] === "Article" || types[k] === "NewsArticle") {
            isArticle = true;
            break;
          }
        }
        if (!isArticle) continue;
        if (!title && item.headline) title = String(item.headline);
        if (!title && item.name) title = String(item.name);
        if (!articleBody && item.articleBody) articleBody = String(item.articleBody);
        if (!publishedAt && item.datePublished) publishedAt = String(item.datePublished);
        if (!publishedAt && item.dateCreated) publishedAt = String(item.dateCreated);
        if (!description && item.description) description = String(item.description);
        var auth = item.author;
        if (auth && !authorName) {
          if (typeof auth === "string") authorName = auth;
          else if (auth.name) authorName = String(auth.name);
        }
      }
    } catch (e) {}
  }

  if (!title) {
    var og = doc.querySelector('meta[property="og:title"]');
    if (og) title = (og.getAttribute("content") || "").trim();
  }
  if (!description) {
    var ogd = doc.querySelector('meta[property="og:description"]');
    if (ogd) description = (ogd.getAttribute("content") || "").trim();
  }

  if (!articleBody) {
    var art = doc.querySelector("article");
    if (art) {
      articleBody = (art.innerText || "").replace(/\s+/g, " ").trim();
    }
  }

  var finalUrl = resp.url || raw;

  return {
    url: finalUrl,
    title: title || null,
    author: authorName || null,
    publishedAt: publishedAt || null,
    description: description || null,
    articleBody: articleBody || null,
    bodyCharacterCount: articleBody ? articleBody.length : 0,
  };
}
