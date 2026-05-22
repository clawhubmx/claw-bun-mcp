/* @meta
{
  "name": "medium/publish-article",
  "description": "打开 Medium 新建文章并尝试写入标题与正文 (publish article: title, body text, optional tags; uses your Chrome session, no API key)",
  "domain": "medium.com",
  "args": {
    "title": { "required": true, "description": "Article title" },
    "content": { "required": true, "description": "Article body (plain text or markdown lines; not full markdown rendering)" },
    "tags": { "required": false, "description": "Comma-separated tags (not applied yet — needs UI or API)" },
    "subtitle": { "required": false, "description": "Subtitle (not applied yet — needs DOM/API)" },
    "canonicalUrl": { "required": false, "description": "Canonical URL (not applied yet — needs publish dialog)" },
    "isDraft": { "required": false, "description": "true/false — not wired; use network capture for draft/publish API" }
  },
  "readOnly": false,
  "example": "bun-browser site medium/publish-article --title \"My First Post\" --content \"# Hello\\n\\nBody text.\" --tags tech,ai"
}
*/

async function (args) {
  function sleep(ms) {
    return new Promise(function (resolve) {
      setTimeout(resolve, ms);
    });
  }

  function parseTags(raw) {
    if (raw == null || raw === "") return [];
    var s = String(raw);
    return s
      .split(",")
      .map(function (t) {
        return t.trim();
      })
      .filter(Boolean)
      .slice(0, 5);
  }

  if (!args.title) return { error: "Missing argument: title" };
  if (args.content == null || String(args.content).length === 0) {
    return { error: "Missing argument: content" };
  }

  var title = String(args.title);
  var content = String(args.content);
  var tags = parseTags(args.tags);
  var subtitle = args.subtitle != null ? String(args.subtitle) : "";
  var canonicalUrl = args.canonicalUrl != null ? String(args.canonicalUrl) : "";

  var host = location.hostname;
  if (host !== "medium.com" && !host.endsWith(".medium.com")) {
    return {
      error: "Not on medium.com",
      hint: "请在已登录的 medium.com 标签页运行，或让 bun-browser 自动打开 medium.com 后再执行。",
      action: "bun-browser open https://medium.com/new-story",
    };
  }

  var path = location.pathname;
  var onNewStory = /\/new-story\/?$/.test(path) || /^\/p\/[a-f0-9]+\/edit$/i.test(path);
  if (!onNewStory) {
    location.assign("https://medium.com/new-story");
    return {
      error: "Redirecting to editor",
      hint: "正在跳转到新建文章页，加载完成后请再次运行同一命令以写入标题与正文。",
      action: "bun-browser site medium/publish-article --title " + JSON.stringify(title) + " --content " + JSON.stringify(content),
    };
  }

  await sleep(2500);

  var titleEl =
    document.querySelector('[data-testid="editorTitleParagraph"]') ||
    document.querySelector("p.graf--title") ||
    document.querySelector('div[role="textbox"][aria-label="Title"]') ||
    document.querySelector('[contenteditable="true"][data-default-value="Title"]');

  if (!titleEl) {
    return {
      error: "Title field not found",
      hint: "Medium 编辑器 DOM 可能已更新。请在写作页用 DevTools 确认标题节点并更新选择器；长期方案请用 bun-browser network requests --with-body 抓取发布接口后用 fetch。",
      action: "bun-browser open https://medium.com/new-story",
    };
  }

  titleEl.focus();
  document.execCommand("selectAll", false, undefined);
  document.execCommand("insertText", false, title);

  var bodyEl =
    document.querySelector('[data-testid="editorParagraphText"]') ||
    document.querySelector("p.graf--p") ||
    (function () {
      var list = document.querySelectorAll('[contenteditable="true"]');
      for (var i = 0; i < list.length; i++) {
        if (list[i] !== titleEl) return list[i];
      }
      return null;
    })();

  if (bodyEl) {
    bodyEl.focus();
    var paragraphs = content.split(/\n{2,}/);
    var plain = paragraphs.length ? paragraphs.join("\n\n") : content;
    document.execCommand("selectAll", false, undefined);
    document.execCommand("insertText", false, plain);
  }

  return {
    partialSuccess: true,
    title: title,
    subtitle: subtitle || undefined,
    canonicalUrl: canonicalUrl || undefined,
    tagsRequested: tags,
    isDraftFlag: args.isDraft,
    editorUrl: location.origin + location.pathname,
    hint:
      "已尝试写入标题与正文。标签、副标题、原创链接、存草稿与正式发布未自动化；请在页面内手动完成，或抓包后用 GraphQL/fetch 替换本 adapter。",
    action: null,
  };
}
