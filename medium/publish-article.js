/* @meta
{
  "name": "medium/publish-article",
  "description": "打开 Medium 新建文章并以类人节奏逐段写入标题与正文 (publish article: title, body text, optional tags; uses your Chrome session, no API key)",
  "domain": "medium.com",
  "args": {
    "title": { "required": true, "description": "Article title" },
    "content": { "required": true, "description": "Article body (plain text; paragraphs separated by blank lines)" },
    "tags": { "required": false, "description": "Comma-separated tags (not applied yet — needs UI or API)" },
    "subtitle": { "required": false, "description": "Subtitle (not applied yet — needs DOM/API)" },
    "canonicalUrl": { "required": false, "description": "Canonical URL (not applied yet — needs publish dialog)" },
    "isDraft": { "required": false, "description": "true/false — not wired; use network capture for draft/publish API" },
    "charDelayMs": { "required": false, "description": "Base ms between word chunks (default 70, jittered ±40ms)" },
    "paragraphDelayMs": { "required": false, "description": "Pause ms between paragraphs (default 900, jittered ±400ms)" },
    "step": { "required": false, "description": "auto | title | body | publish (default auto — runs one phase per invocation to survive Medium draft navigation)" }
  },
  "readOnly": false,
  "example": "bun-browser site medium/publish-article \"My First Post\" \"Paragraph one.\\n\\nParagraph two.\""
}
*/

async function (args) {
  var MAX_TITLE_WORDS = 16;

  function sleep(ms) {
    return new Promise(function (resolve) {
      setTimeout(resolve, ms);
    });
  }

  function parseIntArg(val, fallback) {
    var n = parseInt(String(val == null || val === "" ? fallback : val), 10);
    return Number.isFinite(n) && n >= 0 ? n : fallback;
  }

  function randomDelay(minMs, maxMs) {
    var lo = Math.min(minMs, maxMs);
    var hi = Math.max(minMs, maxMs);
    return sleep(lo + Math.floor(Math.random() * (hi - lo + 1)));
  }

  function selectElementContents(el) {
    if (!el) return;
    var range = document.createRange();
    range.selectNodeContents(el);
    var sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
  }

  function isEditable(el) {
    return el && (el.isContentEditable || el.getAttribute("contenteditable") === "true");
  }

  function isTitleField(el) {
    if (!el) return false;
    if (el.getAttribute && el.getAttribute("data-testid") === "editorTitleParagraph") return true;
    if (el.classList && el.classList.contains("graf--title")) return true;
    if (el.closest && el.closest('[data-testid="editorTitleParagraph"], .graf--title, [data-default-value="Title"]')) {
      return true;
    }
    var label = (el.getAttribute && el.getAttribute("aria-label")) || "";
    return /^title$/i.test(label);
  }

  function normalizeTitle(raw) {
    return String(raw)
      .replace(/[\r\n\u2028\u2029]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function limitTitleWords(text, maxWords) {
    var words = text.split(/\s+/).filter(Boolean);
    if (words.length <= maxWords) {
      return { title: text, wordCount: words.length, truncated: false };
    }
    return {
      title: words.slice(0, maxWords).join(" "),
      wordCount: maxWords,
      truncated: true,
      originalWordCount: words.length,
      originalTitle: text,
    };
  }

  function clickButton(re, root) {
    root = root || document;
    var nodes = root.querySelectorAll("button, a[role='button'], [role='button']");
    for (var i = 0; i < nodes.length; i++) {
      var text = (nodes[i].textContent || "").replace(/\s+/g, " ").trim();
      if (re.test(text)) {
        nodes[i].click();
        return text;
      }
    }
    return null;
  }

  function focusAtEnd(el) {
    if (!el) return;
    el.focus();
    if (isEditable(el)) {
      var range = document.createRange();
      range.selectNodeContents(el);
      range.collapse(false);
      var sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
    }
  }

  function clearElement(el) {
    if (!el) return;
    if (isEditable(el)) {
      focusAtEnd(el);
      selectElementContents(el);
      document.execCommand("delete", false);
    } else {
      el.textContent = "";
      el.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "deleteContentBackward" }));
    }
  }

  async function insertChunk(el, chunk, opts) {
    opts = opts || {};
    if (!el || chunk == null) return;
    chunk = String(chunk);
    if (opts.singleLine) {
      chunk = chunk.replace(/[\r\n\u2028\u2029\t]+/g, " ");
      if (!chunk) return;
    }
    focusAtEnd(el);
    if (isEditable(el)) {
      document.execCommand("insertText", false, chunk);
    } else {
      el.textContent = (el.textContent || "") + chunk;
      el.dispatchEvent(new InputEvent("input", { bubbles: true, data: chunk, inputType: "insertText" }));
    }
  }

  function enterKeyInit() {
    return { key: "Enter", code: "Enter", keyCode: 13, which: 13, bubbles: true, cancelable: true };
  }

  function isBodyParagraph(el, titleEl) {
    if (!el || isTitleField(el)) return false;
    if (titleEl && (el === titleEl || titleEl.contains(el))) return false;
    if (titleEl && el.compareDocumentPosition(titleEl) & Node.DOCUMENT_POSITION_FOLLOWING) return false;
    return true;
  }

  function cleanupEmptyBlocksBeforeTitle(titleEl) {
    if (!titleEl || !titleEl.parentElement) return;
    var child = titleEl.parentElement.firstElementChild;
    while (child && child !== titleEl) {
      var next = child.nextElementSibling;
      if (child.tagName === "P" && !(child.textContent || "").trim()) {
        child.remove();
      }
      child = next;
    }
  }

  function findBodyElement(titleEl) {
    var paras = document.querySelectorAll('[data-testid="editorParagraphText"], p.graf--p');
    for (var i = 0; i < paras.length; i++) {
      if (isTitleField(paras[i])) continue;
      if (titleEl && paras[i].compareDocumentPosition(titleEl) & Node.DOCUMENT_POSITION_FOLLOWING) continue;
      return paras[i];
    }
    var list = document.querySelectorAll('[contenteditable="true"]');
    for (var j = 0; j < list.length; j++) {
      if (isBodyParagraph(list[j], titleEl)) return list[j];
    }
    return null;
  }

  function findLastBodyParagraph(titleEl) {
    var paras = document.querySelectorAll('[data-testid="editorParagraphText"], p.graf--p');
    for (var i = paras.length - 1; i >= 0; i--) {
      if (isBodyParagraph(paras[i], titleEl)) return paras[i];
    }
    return findBodyElement(titleEl);
  }

  async function pressEnter(el, titleEl) {
    var target = isBodyParagraph(el, titleEl) ? el : findLastBodyParagraph(titleEl);
    if (!target || !isBodyParagraph(target, titleEl)) return findBodyElement(titleEl);
    focusAtEnd(target);
    var opts = enterKeyInit();
    target.dispatchEvent(new KeyboardEvent("keydown", opts));
    target.dispatchEvent(new KeyboardEvent("keypress", opts));
    if (isEditable(target)) {
      if (!document.execCommand("insertParagraph", false)) {
        document.execCommand("insertLineBreak", false);
      }
    }
    target.dispatchEvent(new KeyboardEvent("keyup", opts));
    await randomDelay(90, 200);
    return findLastBodyParagraph(titleEl) || target;
  }

  async function pressParagraphBreak(el, titleEl) {
    return (await pressEnter(el, titleEl)) || findBodyElement(titleEl) || el;
  }

  async function typeWords(el, text, charDelayMin, charDelayMax, opts) {
    opts = opts || {};
    var singleLine = !!opts.singleLine;
    var clean = singleLine ? normalizeTitle(text) : String(text).replace(/[\r\n\u2028\u2029]+/g, " ");
    var tokens = clean.match(/\S+\s*/g);
    if (!tokens) {
      if (clean) await insertChunk(el, clean, { singleLine: singleLine });
      return;
    }
    for (var i = 0; i < tokens.length; i++) {
      await insertChunk(el, tokens[i], { singleLine: singleLine });
      await randomDelay(charDelayMin, charDelayMax);
      if (Math.random() < 0.07) {
        await randomDelay(180, 520);
      }
    }
  }

  async function focusBodyFromTitle(titleEl, bodyEl) {
    var target = findBodyElement(titleEl) || bodyEl;
    if (target && isBodyParagraph(target, titleEl)) {
      target.focus();
      focusAtEnd(target);
      await randomDelay(250, 600);
      return target;
    }
    if (titleEl && titleEl.blur) titleEl.blur();
    await randomDelay(150, 350);
    return findBodyElement(titleEl);
  }

  async function typeTitle(el, title, delays, meta) {
    clearElement(el);
    await randomDelay(350, 900);
    await typeWords(el, title, delays.charMin, delays.charMax, { singleLine: true });
    el.textContent = normalizeTitle(el.textContent || title);
    el.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText" }));
    await randomDelay(500, 1200);
    return {
      status: "done",
      charCount: title.length,
      wordCount: meta.wordCount,
      truncated: meta.truncated || undefined,
      originalWordCount: meta.originalWordCount || undefined,
      hasNewline: /[\r\n]/.test(el.textContent || ""),
      preview: title.length > 80 ? title.slice(0, 80) + "…" : title,
    };
  }

  async function waitForSaveReady(maxMs) {
    var deadline = Date.now() + (maxMs || 15000);
    var stableCount = 0;
    while (Date.now() < deadline) {
      var text = (document.body && document.body.innerText) || "";
      if (/cannot save your story/i.test(text)) {
        return { ok: false, error: "save_failed" };
      }
      if (!/Saving\.\.\./i.test(text)) {
        stableCount++;
        if (stableCount >= 2) {
          var buttons = document.querySelectorAll("button");
          for (var i = 0; i < buttons.length; i++) {
            var label = (buttons[i].textContent || "").replace(/\s+/g, " ").trim();
            if (/^Publish$/i.test(label) && !buttons[i].disabled) {
              return { ok: true };
            }
          }
        }
      } else {
        stableCount = 0;
      }
      await sleep(500);
    }
    return { ok: false, error: "save_timeout" };
  }

  function findClickable(re) {
    var nodes = document.querySelectorAll("button, a[role='button'], [role='button']");
    for (var i = 0; i < nodes.length; i++) {
      var text = (nodes[i].textContent || "").replace(/\s+/g, " ").trim();
      if (re.test(text) && !nodes[i].disabled) {
        nodes[i].click();
        return text;
      }
    }
    return null;
  }

  async function publishStory(tags) {
    var onSubmission = /^\/p\/[a-f0-9]+\/submission$/i.test(location.pathname);
    var headerPublish = null;

    if (!onSubmission) {
      var saveReady = await waitForSaveReady(15000);
      if (!saveReady.ok) {
        return { published: false, error: saveReady.error, publishDialogOpened: false };
      }

      await sleep(800);
      headerPublish =
        findClickable(/^Publish$/i) ||
        (document.querySelector('[data-testid="headerPublishButton"]') &&
          !document.querySelector('[data-testid="headerPublishButton"]').disabled &&
          (document.querySelector('[data-testid="headerPublishButton"]').click(), "headerPublishButton"));
      if (!headerPublish) {
        return { published: false, error: "Publish button not found" };
      }
      await sleep(2500);
    }

    if (tags.length) {
      var tagInput =
        document.querySelector('input[placeholder*="tag" i]') ||
        document.querySelector('[data-testid="tagInput"]') ||
        document.querySelector('[contenteditable="true"][data-testid="tagInput"]');
      for (var t = 0; t < tags.length; t++) {
        if (!tagInput) break;
        tagInput.focus();
        if (isEditable(tagInput)) {
          document.execCommand("insertText", false, tags[t]);
        } else {
          tagInput.value = tags[t];
          tagInput.dispatchEvent(new Event("input", { bubbles: true }));
        }
        tagInput.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", code: "Enter", bubbles: true }));
        await randomDelay(400, 800);
      }
      await sleep(500);
    }

    var confirmPatterns = onSubmission
      ? [/^Publish$/i, /^Publish now$/i, /^Publish and send now$/i]
      : [/^Publish now$/i, /^Publish and send now$/i, /^Publish and share$/i];
    var publishNow = null;
    var dialogRoot =
      document.querySelector('[role="dialog"]') ||
      document.querySelector('[data-testid="publishDialog"]') ||
      document.body;
    for (var p = 0; p < confirmPatterns.length; p++) {
      var nodes = dialogRoot.querySelectorAll("button, a[role='button'], [role='button']");
      for (var n = 0; n < nodes.length; n++) {
        var label = (nodes[n].textContent || "").replace(/\s+/g, " ").trim();
        if (confirmPatterns[p].test(label) && !nodes[n].disabled) {
          nodes[n].click();
          publishNow = label;
          break;
        }
      }
      if (publishNow) break;
    }
    if (!publishNow) {
      var confirmEl =
        document.querySelector('[data-testid="publishConfirmButton"]') ||
        document.querySelector('[data-testid="publishDialogPublishButton"]');
      if (confirmEl && !confirmEl.disabled) {
        confirmEl.click();
        publishNow = confirmEl.getAttribute("data-testid");
      }
    }
    if (!publishNow) {
      var snippet = ((document.body && document.body.innerText) || "").slice(0, 400);
      return { published: false, error: "Publish confirm button not found", publishDialogOpened: true, dialogSnippet: snippet };
    }

    await sleep(4000);
    var url = location.href;
    var pageText = (document.body && document.body.innerText) || "";
    var onStory = /medium\.com\/(@[\w-]+\/[\w-]+|p\/[a-f0-9]+)/i.test(url) && !/\/edit/.test(url);
    return {
      published: onStory || /your story is live|published/i.test(pageText),
      publishUrl: onStory ? url : undefined,
      publishDialogOpened: true,
      confirmClicked: publishNow,
    };
  }

  async function typeBodyParagraphs(bodyEl, paragraphs, delays, titleEl) {
    var nonEmpty = paragraphs.filter(function (p) {
      return p.trim();
    });
    var total = nonEmpty.length;
    var progress = [];
    var written = 0;
    var currentEl = findBodyElement(titleEl) || bodyEl;

    if (!currentEl || !isBodyParagraph(currentEl, titleEl)) {
      return progress;
    }

    clearElement(currentEl);
    focusAtEnd(currentEl);

    for (var i = 0; i < paragraphs.length; i++) {
      var para = paragraphs[i].trim();
      if (!para) continue;
      written++;

      currentEl = findLastBodyParagraph(titleEl) || currentEl;
      if (!isBodyParagraph(currentEl, titleEl)) break;

      var entry = {
        index: written,
        total: total,
        preview: para.length > 72 ? para.slice(0, 72) + "…" : para,
        status: "typing",
      };
      progress.push(entry);

      await typeWords(currentEl, para, delays.charMin, delays.charMax);
      entry.status = "done";
      entry.charCount = para.length;

      var hasMore = false;
      for (var j = i + 1; j < paragraphs.length; j++) {
        if (paragraphs[j].trim()) {
          hasMore = true;
          break;
        }
      }
      if (hasMore) {
        currentEl = (await pressParagraphBreak(currentEl, titleEl)) || currentEl;
        await randomDelay(delays.paraMin, delays.paraMax);
      }
    }

    return progress;
  }

  function findTitleElement() {
    return (
      document.querySelector('[data-testid="editorTitleParagraph"]') ||
      document.querySelector("p.graf--title") ||
      document.querySelector("h3.graf--title") ||
      document.querySelector('div[role="textbox"][aria-label="Title"]') ||
      document.querySelector('[contenteditable="true"][data-default-value="Title"]')
    );
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

  function editorTitleText(titleEl) {
    return normalizeTitle(titleEl.textContent || "");
  }

  function bodyCharCount(titleEl) {
    var paras = document.querySelectorAll('[data-testid="editorParagraphText"], p.graf--p');
    var total = 0;
    for (var i = 0; i < paras.length; i++) {
      if (isBodyParagraph(paras[i], titleEl)) total += (paras[i].textContent || "").length;
    }
    return total;
  }

  function resolveStep(stepArg, titleEl, title, content) {
    var step = String(stepArg || "auto").toLowerCase();
    if (/^\/p\/[a-f0-9]+\/submission$/i.test(location.pathname)) return "publish";
    if (step !== "auto") return step;
    if (!titleEl) return "title";
    var expectedTitle = normalizeTitle(title);
    var currentTitle = editorTitleText(titleEl);
    var bodyChars = bodyCharCount(titleEl);
    var expectedBodyChars = content.replace(/\s+/g, " ").length;
    if (currentTitle !== expectedTitle || currentTitle.length < 3) return "title";
    if (bodyChars < expectedBodyChars * 0.5) return "body";
    return "publish";
  }

  if (!args.title) return { error: "Missing argument: title" };
  if (args.content == null || String(args.content).length === 0) {
    return { error: "Missing argument: content" };
  }

  var titleRaw = String(args.title);
  var titleNorm = normalizeTitle(titleRaw);
  var titleMeta = limitTitleWords(titleNorm, MAX_TITLE_WORDS);
  var title = titleMeta.title;
  var content = String(args.content);
  var tags = parseTags(args.tags);
  var subtitle = args.subtitle != null ? String(args.subtitle) : "";
  var canonicalUrl = args.canonicalUrl != null ? String(args.canonicalUrl) : "";

  var charBase = parseIntArg(args.charDelayMs, 70);
  var paraBase = parseIntArg(args.paragraphDelayMs, 900);
  var delays = {
    charMin: Math.max(20, charBase - 40),
    charMax: charBase + 40,
    paraMin: Math.max(300, paraBase - 400),
    paraMax: paraBase + 400,
  };

  var host = location.hostname;
  if (host !== "medium.com" && !host.endsWith(".medium.com")) {
    return {
      error: "Not on medium.com",
      hint: "请在已登录的 medium.com 标签页运行，或让 bun-browser 自动打开 medium.com 后再执行。",
      action: "bun-browser open https://medium.com/new-story",
    };
  }

  var path = location.pathname;
  var onEditor =
    /\/new-story\/?$/.test(path) ||
    /^\/p\/[a-f0-9]+\/edit$/i.test(path) ||
    /^\/p\/[a-f0-9]+\/submission$/i.test(path);
  if (!onEditor) {
    location.assign("https://medium.com/new-story");
    return {
      error: "Redirecting to editor",
      hint: "正在跳转到新建文章页，加载完成后请再次运行同一命令以写入标题与正文。",
      action: 'bun-browser site medium/publish-article ' + JSON.stringify(title) + " " + JSON.stringify(content),
    };
  }

  var preStep = String(args.step || "auto").toLowerCase();
  var onSubmission = /^\/p\/[a-f0-9]+\/submission$/i.test(path);
  await sleep(onSubmission || preStep === "publish" ? 800 : 2500);

  var titleEl = findTitleElement();

  if (!titleEl && !onSubmission) {
    return {
      error: "Title field not found",
      hint: "Medium 编辑器 DOM 可能已更新。请在写作页用 DevTools 确认标题节点并更新选择器；长期方案请用 bun-browser network requests --with-body 抓取发布接口后用 fetch。",
      action: "bun-browser open https://medium.com/new-story",
    };
  }

  if (titleEl) cleanupEmptyBlocksBeforeTitle(titleEl);

  var step = onSubmission ? "publish" : resolveStep(args.step, titleEl, title, content);
  var baseResult = {
    typingMode: "human-enter",
    step: step,
    title: title,
    titleOriginal: titleMeta.truncated ? titleMeta.originalTitle : undefined,
    titleMaxWords: MAX_TITLE_WORDS,
    subtitle: subtitle || undefined,
    canonicalUrl: canonicalUrl || undefined,
    tagsRequested: tags,
    isDraftFlag: args.isDraft,
    editorUrl: location.origin + location.pathname,
  };

  if (step === "title") {
    var titleOnlyProgress = await typeTitle(titleEl, title, delays, titleMeta);
    return Object.assign({}, baseResult, {
      partialSuccess: true,
      titleProgress: titleOnlyProgress,
      nextStep: "body",
      hint: "标题已写入（最多 " + MAX_TITLE_WORDS + " 词，无换行）。请再次运行同一命令继续写入正文。",
      action: null,
    });
  }

  if (step === "body") {
    var bodyEl = findBodyElement(titleEl);
    if (!bodyEl) {
      return Object.assign({}, baseResult, {
        partialSuccess: true,
        error: "Body field not found",
        hint: "正文区域未找到。若刚写入标题，请等待草稿页加载完成后再运行。",
      });
    }
    bodyEl = (await focusBodyFromTitle(titleEl, bodyEl)) || bodyEl;
    var paragraphs = content.split(/\n{2,}/);
    var bodyOnlyProgress = await typeBodyParagraphs(bodyEl, paragraphs, delays, titleEl);
    return Object.assign({}, baseResult, {
      partialSuccess: true,
      titleProgress: {
        status: "done",
        wordCount: titleMeta.wordCount,
        preview: title.length > 80 ? title.slice(0, 80) + "…" : title,
        hasNewline: /[\r\n]/.test(editorTitleText(titleEl)),
      },
      bodyWritten: bodyOnlyProgress.length > 0,
      paragraphsWritten: bodyOnlyProgress.length,
      progress: bodyOnlyProgress,
      nextStep: "publish",
      hint: "正文已逐段写入（Enter 分段）。请再次运行同一命令以发布。",
      action: null,
    });
  }

  if (step === "publish") {
    if (!titleEl && onSubmission) {
      titleEl = document.querySelector('[data-testid="editorTitleParagraph"]');
    }
    var publishOnly = await publishStory(tags);
    return Object.assign({}, baseResult, {
      partialSuccess: !publishOnly.published,
      success: !!publishOnly.published,
      publish: publishOnly,
      hint: publishOnly.published
        ? "文章已发布。"
        : publishOnly.publishDialogOpened
          ? "发布对话框已打开但未完成；请在页面内确认并点击 Publish now。"
          : publishOnly.error === "save_failed"
            ? "Medium 无法保存草稿，请检查编辑器内容后重试。"
            : "发布步骤未完成，请在页面内手动点击 Publish。",
      action: null,
    });
  }

  return Object.assign({}, baseResult, {
    error: "Unknown step: " + step,
    hint: "Use step auto, title, body, or publish.",
  });
}
