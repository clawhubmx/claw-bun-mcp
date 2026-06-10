/* @meta
{
  "name": "notion/create-article",
  "description": "Create a new Notion page (article) with title and plain-text body under the current or specified parent page",
  "domain": "app.notion.com",
  "args": {
    "title": {"required": true, "description": "Page title"},
    "content": {"required": true, "description": "Article body (plain text; paragraphs separated by blank lines)"},
    "parent": {"required": false, "description": "Parent page URL or 32-char page id. Defaults to the open workspace page."},
    "step": {"required": false, "description": "auto | open | title | body (default auto — one phase per invocation; wait ~10s between open and title)"}
  },
  "readOnly": false,
  "example": "bun-browser site notion/create-article \"Weekly Recap\" \"Lead paragraph.\\n\\nSecond paragraph.\""
}
*/

async function(args) {
  function hasCookie(name) {
    return document.cookie.split(';').some(function(c) {
      return c.trim().startsWith(name + '=');
    });
  }

  if (!hasCookie('notion_user_id') || !hasCookie('notion_users')) {
    return {
      error: 'Not logged in',
      hint: 'Log into Notion at app.notion.com before creating pages',
      action: 'bun-browser open https://www.notion.so/'
    };
  }

  var title = args.title != null ? String(args.title).trim() : '';
  var content = args.content != null ? String(args.content) : '';
  content = content.replace(/\\n/g, '\n');
  var step = String(args.step || 'auto').trim().toLowerCase();
  if (step !== 'auto' && step !== 'open' && step !== 'title' && step !== 'body') {
    return { error: 'Invalid step', hint: 'step must be auto, open, title, or body' };
  }

  if (!title) {
    return { error: 'Missing argument: title', hint: 'Provide a page title for the new article' };
  }
  if (!content.trim()) {
    return { error: 'Missing argument: content', hint: 'Provide article body text (paragraphs separated by blank lines)' };
  }

  function sleep(ms) {
    return new Promise(function(resolve) { setTimeout(resolve, ms); });
  }

  function isElementVisible(el) {
    if (!el) return false;
    if (el.getAttribute('aria-hidden') === 'true') return false;
    var style = window.getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) return false;
    var rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  function clickElement(el) {
    if (!el) return false;
    try { el.focus(); } catch (e) {}
    el.click();
    return true;
  }

  function activateEditor(el) {
    if (!el) return false;
    var rect = el.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return clickElement(el);
    var x = rect.left + rect.width / 2;
    var y = rect.top + rect.height / 2;
    ['mousedown', 'mouseup', 'click'].forEach(function(type) {
      el.dispatchEvent(new MouseEvent(type, {
        bubbles: true,
        cancelable: true,
        view: window,
        clientX: x,
        clientY: y
      }));
    });
    try { el.focus(); } catch (e) {}
    return true;
  }

  function findByAriaLabel(label, root) {
    root = root || document;
    var target = String(label || '').trim().toLowerCase();
    var els = Array.prototype.slice.call(root.querySelectorAll('[aria-label], [role=button], button'));
    var fallback = null;
    for (var i = 0; i < els.length; i++) {
      var aria = (els[i].getAttribute('aria-label') || '').trim().toLowerCase();
      if (aria !== target) continue;
      if (isElementVisible(els[i])) return els[i];
      if (!fallback) fallback = els[i];
    }
    return fallback;
  }

  function findMenuItemByText(text) {
    var target = String(text || '').trim().toLowerCase();
    var items = Array.prototype.slice.call(document.querySelectorAll('[role=menuitem], [role=option]'));
    for (var i = 0; i < items.length; i++) {
      var label = (items[i].innerText || items[i].textContent || '').trim();
      var firstLine = label.split('\n')[0].trim().toLowerCase();
      if ((firstLine === target || label.toLowerCase() === target) && isElementVisible(items[i])) {
        return { el: items[i], label: label.split('\n')[0].trim() };
      }
    }
    return null;
  }

  async function clickMenuItemByText(text) {
    var match = await waitFor(function() { return findMenuItemByText(text); }, 3000, 200);
    if (!match) return null;
    clickElement(match.el);
    return match.label;
  }

  function parsePageId(raw) {
    if (!raw) return null;
    var text = String(raw).trim();
    var fromUrl = text.match(/([0-9a-f]{32})/i);
    if (fromUrl) return fromUrl[1].toLowerCase();
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(text)) {
      return text.replace(/-/g, '').toLowerCase();
    }
    return null;
  }

  function buildPageUrl(pageId) {
    var id = parsePageId(pageId);
    if (!id) return null;
    return 'https://app.notion.com/p/' + id;
  }

  function getCurrentPageId() {
    return parsePageId(location.pathname);
  }

  function getTitleEditor() {
    return document.querySelector('h1[contenteditable="true"][role="textbox"]');
  }

  function getTitleText() {
    var titleEl = getTitleEditor();
    return titleEl ? String(titleEl.innerText || titleEl.textContent || '').trim() : '';
  }

  function isFreshNewPage() {
    var titleEl = getTitleEditor();
    if (!titleEl) return false;
    var placeholder = (titleEl.getAttribute('placeholder') || '').trim();
    var text = getTitleText();
    if (placeholder === 'New page' && !text) return true;
    return /saveParent=true/.test(location.search) && !text;
  }

  function dismissBlockingDialog() {
    var dismiss = Array.prototype.slice.call(document.querySelectorAll('button, [role=button]')).find(function(el) {
      var label = (el.innerText || el.getAttribute('aria-label') || '').trim();
      return label === 'Dismiss';
    });
    if (dismiss && isElementVisible(dismiss)) {
      clickElement(dismiss);
      return true;
    }
    return false;
  }

  function focusAtEnd(el) {
    if (!el) return;
    activateEditor(el);
    el.focus();
    var selection = window.getSelection();
    if (!selection) return;
    var range = document.createRange();
    range.selectNodeContents(el);
    range.collapse(false);
    selection.removeAllRanges();
    selection.addRange(range);
  }

  function clearEditable(el) {
    if (!el) return;
    focusAtEnd(el);
    if (String(el.innerText || el.textContent || '').trim()) {
      document.execCommand('selectAll', false, null);
      document.execCommand('delete', false, null);
    } else {
      el.textContent = '';
    }
  }

  function setEditableText(el, text) {
    if (!el) return false;
    text = String(text);
    clearEditable(el);
    var inserted = document.execCommand('insertText', false, text);
    if (!inserted) {
      el.textContent = text;
    }
    el.dispatchEvent(new InputEvent('input', {
      bubbles: true,
      inputType: 'insertText',
      data: text
    }));
    return String(el.innerText || el.textContent || '').trim().length > 0;
  }

  function pressEnter(el) {
    if (!el) return;
    el.focus();
    var opts = { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true };
    el.dispatchEvent(new KeyboardEvent('keydown', opts));
    el.dispatchEvent(new KeyboardEvent('keypress', opts));
    el.dispatchEvent(new KeyboardEvent('keyup', opts));
  }

  function isTitleEditorReady(el) {
    if (!el) return false;
    var rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  function isBodyEditor(el, titleEl) {
    if (!el || el === titleEl) return false;
    if (el.getAttribute('aria-roledescription') === 'page title') return false;
    if (el.getAttribute('role') === 'editor') return false;
    if (el.getAttribute('contenteditable') !== 'true') return false;
    var placeholder = el.getAttribute('placeholder') || '';
    if (/press/i.test(placeholder)) return true;
    if (placeholder.trim() === '' || placeholder === ' ') return true;
    return el.tagName !== 'H1';
  }

  function ensureBodyEditor(titleEl) {
    titleEl = titleEl || getTitleEditor();
    var bodyEl = getBodyEditor(titleEl);
    if (bodyEl) return bodyEl;

    pressEnter(titleEl);
    focusAtEnd(titleEl);
    document.execCommand('insertParagraph', false);

    if (titleEl) {
      var rect = titleEl.getBoundingClientRect();
      var target = document.elementFromPoint(rect.left + 40, rect.bottom + 80);
      if (target) {
        try { target.click(); } catch (e) {}
        if (isBodyEditor(target, titleEl)) return target;
      }
    }

    return getBodyEditor(titleEl);
  }

  function getBodyEditor(titleEl) {
    titleEl = titleEl || getTitleEditor();
    var leaves = Array.prototype.slice.call(document.querySelectorAll(
      '[data-content-editable-leaf="true"], .content-editable-leaf-rtl[contenteditable="true"], [contenteditable="true"][placeholder]'
    ));
    for (var i = 0; i < leaves.length; i++) {
      if (isBodyEditor(leaves[i], titleEl)) return leaves[i];
    }
    var active = document.activeElement;
    if (isBodyEditor(active, titleEl)) return active;
    return null;
  }

  function splitParagraphs(text) {
    return String(text)
      .replace(/\r\n/g, '\n')
      .split(/\n\s*\n/)
      .map(function(part) { return part.replace(/\s+/g, ' ').trim(); })
      .filter(Boolean);
  }

  async function waitFor(fn, timeoutMs, intervalMs) {
    timeoutMs = timeoutMs || 10000;
    intervalMs = intervalMs || 250;
    var start = Date.now();
    while (Date.now() - start < timeoutMs) {
      var value = fn();
      if (value) return value;
      await sleep(intervalMs);
    }
    return null;
  }

  function writeTitleSync(titleText) {
    dismissBlockingDialog();
    var titleEl = getTitleEditor();
    if (!isTitleEditorReady(titleEl)) {
      return { ok: false, titleSeen: '', reason: 'title editor not ready' };
    }

    clearEditable(titleEl);
    var inserted = document.execCommand('insertText', false, titleText);
    if (!inserted) {
      return { ok: false, titleSeen: getTitleText(), reason: 'insertText failed' };
    }
    titleEl.dispatchEvent(new InputEvent('input', {
      bubbles: true,
      inputType: 'insertText',
      data: titleText
    }));

    titleEl = getTitleEditor() || titleEl;
    var seen = (titleEl.innerText || titleEl.textContent || '').trim();
    if (seen === titleText) {
      return { ok: true, titleEl: titleEl, titleSeen: seen };
    }
    return { ok: false, titleSeen: seen, reason: 'title text did not stick' };
  }

  function writeBodySync(titleEl, paragraphs) {
    titleEl = titleEl || getTitleEditor();
    var bodyEl = ensureBodyEditor(titleEl);
    if (!bodyEl) {
      return {
        ok: false,
        error: 'Body editor not found',
        hint: 'Re-run with step=body after the title step creates the first body block.',
        title: getTitleText()
      };
    }

    for (var i = 0; i < paragraphs.length; i++) {
      activateEditor(bodyEl);
      setEditableText(bodyEl, paragraphs[i]);
      if (i < paragraphs.length - 1) {
        pressEnter(bodyEl);
        var next = document.activeElement;
        if (isBodyEditor(next, titleEl)) {
          bodyEl = next;
        } else {
          bodyEl = getBodyEditor(titleEl) || bodyEl;
        }
      }
    }

    var written = Array.prototype.slice.call(document.querySelectorAll('[data-content-editable-leaf="true"], [contenteditable="true"]'))
      .filter(function(el) {
        return el.getAttribute('aria-roledescription') !== 'page title' && String(el.innerText || el.textContent || '').trim();
      })
      .map(function(el) { return String(el.innerText || el.textContent || '').trim(); });

    return {
      ok: true,
      title: getTitleText() || (titleEl && (titleEl.innerText || titleEl.textContent || '').trim()) || '',
      paragraphCount: paragraphs.length,
      bodyPreview: written.slice(0, 3),
      bodyCharacterCount: written.join('\n\n').length
    };
  }

  function resolveAutoStep() {
    if (getTitleText() === title) return 'body';
    if (isFreshNewPage() || (getTitleEditor() && !getTitleText())) return 'title';
    return 'open';
  }

  async function navigateToParent(parentArg) {
    var parentId = parsePageId(parentArg);
    if (!parentId) {
      return {
        error: 'Invalid parent page',
        hint: 'parent must be a Notion page URL or 32-char page id',
        action: 'bun-browser open https://app.notion.com/'
      };
    }
    var targetUrl = buildPageUrl(parentId);
    if (getCurrentPageId() !== parentId) {
      location.href = targetUrl;
      return {
        error: 'Navigation required',
        hint: 'Re-run the same command after Notion opens the parent page.',
        action: 'retry same command',
        parent: parentId,
        url: targetUrl
      };
    }
    var ready = await waitFor(function() {
      return findByAriaLabel('New page') || getTitleEditor();
    }, 12000, 300);
    if (!ready) {
      return {
        error: 'Parent page not ready',
        hint: 'Open the parent page in Notion, then retry create-article.',
        action: 'bun-browser open ' + targetUrl
      };
    }
    return { ok: true, parentId: parentId, url: targetUrl };
  }

  async function openBlankPage() {
    var newPageBtn = await waitFor(function() { return findByAriaLabel('New page'); }, 8000, 300);
    if (!newPageBtn) {
      return {
        error: 'New page button not found',
        hint: 'Open a Notion workspace page that allows creating child pages, then retry.',
        action: 'bun-browser open https://app.notion.com/'
      };
    }

    var beforeHref = location.href;
    clickElement(newPageBtn);
    await sleep(1100);

    var picked = await clickMenuItemByText('Page');
    if (!picked) {
      return {
        error: 'Page menu item not found',
        hint: 'Notion did not show the New page menu. Retry on an open workspace page.',
        action: 'retry same command'
      };
    }

    var navigated = await waitFor(function() {
      return location.href !== beforeHref ? location.href : null;
    }, 10000, 300);
    if (!navigated) {
      return {
        error: 'New page navigation timed out',
        hint: 'Retry create-article on the parent page.',
        action: 'retry same command'
      };
    }

    return {
      error: 'Navigation required',
      hint: 'Wait ~10s for the blank page to finish loading, then re-run the same command (auto continues with title, then body).',
      action: 'retry same command',
      pageId: getCurrentPageId(),
      url: location.href.split('?')[0],
      nextStep: 'title'
    };
  }

  var paragraphs = splitParagraphs(content);
  if (!paragraphs.length) {
    return { error: 'Empty content', hint: 'Provide at least one non-empty paragraph.' };
  }

  var activeStep = step === 'auto' ? resolveAutoStep() : step;

  if (activeStep === 'title') {
    if (!isFreshNewPage() && getTitleText() !== title) {
      return {
        error: 'Not on a blank page',
        hint: 'Run create-article on a parent page first (step=open or default auto), wait ~10s after Navigation required, then retry.',
        action: 'retry same command',
        step: 'open'
      };
    }
    var titleResult = writeTitleSync(title);
    if (!titleResult.ok) {
      return {
        error: 'Could not set page title',
        hint: 'Wait ~10s after the blank page opens, then re-run the same command.',
        action: 'retry same command',
        url: location.href,
        titleSeen: titleResult.titleSeen,
        reason: titleResult.reason,
        step: 'title'
      };
    }
    ensureBodyEditor(titleResult.titleEl);
    return {
      partialSuccess: true,
      step: 'title',
      nextStep: 'body',
      title: titleResult.titleSeen,
      pageId: getCurrentPageId(),
      url: location.href.split('?')[0],
      hint: 'Title written. Re-run the same command to fill the body.',
      action: 'retry same command'
    };
  }

  if (activeStep === 'body') {
    var bodyResult = writeBodySync(getTitleEditor(), paragraphs);
    if (!bodyResult.ok) return bodyResult;
    return {
      title: bodyResult.title,
      content: content,
      paragraphCount: bodyResult.paragraphCount,
      bodyCharacterCount: bodyResult.bodyCharacterCount,
      bodyPreview: bodyResult.bodyPreview,
      pageId: getCurrentPageId(),
      url: location.href.split('?')[0],
      parent: args.parent ? parsePageId(args.parent) : null,
      created: true,
      step: 'body'
    };
  }

  if (activeStep === 'open') {
    if (args.parent) {
      var parentNavOpen = await navigateToParent(args.parent);
      if (!parentNavOpen.ok) return parentNavOpen;
    }
    return await openBlankPage();
  }

  if (args.parent) {
    var parentNav = await navigateToParent(args.parent);
    if (!parentNav.ok) return parentNav;
  } else if (!isFreshNewPage() && getTitleText() !== title) {
    var workspaceReady = await waitFor(function() {
      return findByAriaLabel('New page') || getTitleEditor();
    }, 12000, 300);
    if (!workspaceReady && !getCurrentPageId()) {
      return {
        error: 'No parent page',
        hint: 'Open a parent Notion page first, or pass parent=<page-url-or-id>.',
        action: 'bun-browser open https://app.notion.com/'
      };
    }
  }

  return await openBlankPage();
}
