/* @meta
{
  "name": "notion/edit-article",
  "description": "Edit an existing Notion page: update title and/or replace or append plain-text body",
  "domain": "app.notion.com",
  "args": {
    "page": {"required": true, "description": "Page URL or 32-char page id to edit"},
    "content": {"required": true, "description": "Body text (plain text; paragraphs separated by blank lines)"},
    "title": {"required": false, "description": "New page title (omit to keep current title)"},
    "mode": {"required": false, "description": "replace | append (default replace)"},
    "step": {"required": false, "description": "auto | navigate | title | body (default auto — one phase per invocation)"}
  },
  "readOnly": false,
  "example": "bun-browser site notion/edit-article \"https://app.notion.com/p/37b773dd10fd80288a68c2fda0897975\" \"Updated lead.\\n\\nSecond paragraph.\" --title \"Weekly Recap (Updated)\""
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
      hint: 'Log into Notion at app.notion.com before editing pages',
      action: 'bun-browser open https://www.notion.so/'
    };
  }

  var pageArg = args.page != null ? String(args.page).trim() : '';
  var title = args.title != null ? String(args.title).trim() : '';
  var content = args.content != null ? String(args.content) : '';
  content = content.replace(/\\n/g, '\n');
  var mode = String(args.mode || 'replace').trim().toLowerCase();
  if (mode !== 'replace' && mode !== 'append') {
    return { error: 'Invalid mode', hint: 'mode must be replace or append' };
  }
  var step = String(args.step || 'auto').trim().toLowerCase();
  if (step !== 'auto' && step !== 'navigate' && step !== 'title' && step !== 'body') {
    return { error: 'Invalid step', hint: 'step must be auto, navigate, title, or body' };
  }

  if (!pageArg) {
    return { error: 'Missing argument: page', hint: 'Provide the page URL or 32-char page id to edit' };
  }
  if (!content.trim()) {
    return { error: 'Missing argument: content', hint: 'Provide article body text (paragraphs separated by blank lines)' };
  }

  var targetPageId = parsePageId(pageArg);
  if (!targetPageId) {
    return {
      error: 'Invalid page',
      hint: 'page must be a Notion page URL or 32-char page id',
      action: 'bun-browser open https://app.notion.com/'
    };
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
    var hadContent = String(el.innerText || el.textContent || '').trim().length > 0;
    activateEditor(el);
    focusAtEnd(el);

    if (hadContent) {
      document.execCommand('selectAll', false, null);
      document.execCommand('delete', false, null);
    } else {
      clearEditable(el);
    }

    var inserted = document.execCommand('insertText', false, text);
    if (!inserted || String(el.innerText || el.textContent || '').trim() !== text.trim()) {
      var beforeInput = new InputEvent('beforeinput', {
        bubbles: true,
        cancelable: true,
        inputType: hadContent ? 'insertReplacementText' : 'insertText',
        data: text
      });
      el.dispatchEvent(beforeInput);
      if (!beforeInput.defaultPrevented) {
        el.textContent = text;
      }
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

  function pressBackspace(el) {
    if (!el) return;
    el.focus();
    var opts = { key: 'Backspace', code: 'Backspace', keyCode: 8, which: 8, bubbles: true, cancelable: true };
    el.dispatchEvent(new KeyboardEvent('keydown', opts));
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

  function getAllBodyEditors(titleEl) {
    titleEl = titleEl || getTitleEditor();
    return Array.prototype.slice.call(document.querySelectorAll(
      '[data-content-editable-leaf="true"], .content-editable-leaf-rtl[contenteditable="true"], [contenteditable="true"][placeholder]'
    )).filter(function(el) {
      return isBodyEditor(el, titleEl);
    });
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

    var current = getTitleText();
    activateEditor(titleEl);
    focusAtEnd(titleEl);

    if (current) {
      document.execCommand('selectAll', false, null);
      document.execCommand('delete', false, null);
    } else {
      clearEditable(titleEl);
    }

    var inserted = document.execCommand('insertText', false, titleText);
    if (!inserted || getTitleText() !== titleText) {
      var beforeInput = new InputEvent('beforeinput', {
        bubbles: true,
        cancelable: true,
        inputType: current ? 'insertReplacementText' : 'insertText',
        data: titleText
      });
      titleEl.dispatchEvent(beforeInput);
      if (!beforeInput.defaultPrevented) {
        titleEl.textContent = titleText;
      }
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

  function clearBodySync(titleEl) {
    titleEl = titleEl || getTitleEditor();
    var blocks = getAllBodyEditors(titleEl);
    if (!blocks.length) return { ok: true, cleared: 0 };

    for (var i = blocks.length - 1; i >= 0; i--) {
      clearEditable(blocks[i]);
      if (i > 0) {
        focusAtEnd(blocks[i]);
        pressBackspace(blocks[i]);
      }
    }

    return { ok: true, cleared: blocks.length };
  }

  function ensureBodyBlockAtIndex(titleEl, index) {
    titleEl = titleEl || getTitleEditor();
    var blocks = getAllBodyEditors(titleEl);
    if (!blocks.length) {
      ensureBodyEditor(titleEl);
      blocks = getAllBodyEditors(titleEl);
    }
    while (blocks.length <= index) {
      var last = blocks[blocks.length - 1];
      if (!last) {
        last = ensureBodyEditor(titleEl);
        blocks = getAllBodyEditors(titleEl);
        if (!blocks.length) return last;
      }
      focusAtEnd(last);
      pressEnter(last);
      document.execCommand('insertParagraph', false);
      blocks = getAllBodyEditors(titleEl);
    }
    return blocks[index];
  }

  function replaceEditableText(el, text) {
    if (!el) return false;
    text = String(text);
    activateEditor(el);
    el.focus();
    if (String(el.innerText || el.textContent || '').trim()) {
      document.execCommand('selectAll', false, null);
      document.execCommand('delete', false, null);
    }
    var beforeInput = new InputEvent('beforeinput', {
      bubbles: true,
      cancelable: true,
      inputType: 'insertReplacementText',
      data: text
    });
    el.dispatchEvent(beforeInput);
    if (!beforeInput.defaultPrevented) {
      el.textContent = text;
    }
    el.dispatchEvent(new InputEvent('input', {
      bubbles: true,
      inputType: 'insertText',
      data: text
    }));
    return String(el.innerText || el.textContent || '').trim() === text.trim();
  }

  function writeBodySync(titleEl, paragraphs, editMode) {
    titleEl = titleEl || getTitleEditor();

    if (editMode === 'append') {
      var existing = getAllBodyEditors(titleEl);
      var startIdx = existing.length;
      if (!startIdx) {
        ensureBodyEditor(titleEl);
        startIdx = 0;
      }
      for (var a = 0; a < paragraphs.length; a++) {
        var appendEl = ensureBodyBlockAtIndex(titleEl, startIdx + a);
        if (!appendEl) {
          return {
            ok: false,
            error: 'Body editor not found',
            hint: 'Re-run with step=body after the page finishes loading.',
            title: getTitleText()
          };
        }
        activateEditor(appendEl);
        replaceEditableText(appendEl, paragraphs[a]);
      }
    } else {
      var blocks = getAllBodyEditors(titleEl);
      var bodyEl = blocks[0] || ensureBodyEditor(titleEl);
      if (!bodyEl) {
        return {
          ok: false,
          error: 'Body editor not found',
          hint: 'Re-run with step=body after the page finishes loading.',
          title: getTitleText()
        };
      }

      var bodyText = paragraphs.join('\n\n');
      if (!replaceEditableText(bodyEl, bodyText)) {
        return {
          ok: false,
          error: 'Could not set body text',
          hint: 'Re-run with step=body after the page finishes loading.',
          title: getTitleText()
        };
      }
    }

    if (!paragraphs.length) {
      return {
        ok: false,
        error: 'Body editor not found',
        hint: 'Re-run with step=body after the page finishes loading.',
        title: getTitleText()
      };
    }

    var written = getAllBodyEditors(titleEl)
      .map(function(el) { return String(el.innerText || el.textContent || '').trim(); })
      .filter(Boolean);

    return {
      ok: true,
      title: getTitleText() || (titleEl && (titleEl.innerText || titleEl.textContent || '').trim()) || '',
      paragraphCount: paragraphs.length,
      bodyPreview: written.slice(0, 5),
      bodyCharacterCount: written.join('\n\n').length,
      mode: editMode
    };
  }

  function resolveAutoStep() {
    if (getCurrentPageId() !== targetPageId) return 'navigate';
    if (title && getTitleText() !== title) return 'title';
    return 'body';
  }

  async function navigateToPage() {
    var targetUrl = buildPageUrl(targetPageId);
    if (getCurrentPageId() !== targetPageId) {
      location.href = targetUrl;
      return {
        error: 'Navigation required',
        hint: 'Re-run the same command after Notion opens the page.',
        action: 'retry same command',
        page: targetPageId,
        url: targetUrl
      };
    }
    var ready = await waitFor(function() {
      return getTitleEditor();
    }, 12000, 300);
    if (!ready) {
      return {
        error: 'Page not ready',
        hint: 'Open the page in Notion, then retry edit-article.',
        action: 'bun-browser open ' + targetUrl
      };
    }
    return { ok: true, pageId: targetPageId, url: targetUrl, title: getTitleText() };
  }

  var paragraphs = splitParagraphs(content);
  if (!paragraphs.length) {
    return { error: 'Empty content', hint: 'Provide at least one non-empty paragraph.' };
  }

  var activeStep = step === 'auto' ? resolveAutoStep() : step;

  if (activeStep === 'navigate') {
    return await navigateToPage();
  }

  if (getCurrentPageId() !== targetPageId) {
    return await navigateToPage();
  }

  if (activeStep === 'title') {
    if (!title) {
      return {
        partialSuccess: true,
        step: 'title',
        nextStep: 'body',
        skipped: true,
        hint: 'No title provided — re-run to update body.',
        action: 'retry same command',
        pageId: getCurrentPageId(),
        url: location.href.split('?')[0]
      };
    }
    var titleResult = writeTitleSync(title);
    if (!titleResult.ok) {
      return {
        error: 'Could not set page title',
        hint: 'Wait for the page to finish loading, then re-run the same command.',
        action: 'retry same command',
        url: location.href,
        titleSeen: titleResult.titleSeen,
        reason: titleResult.reason,
        step: 'title'
      };
    }
    return {
      partialSuccess: true,
      step: 'title',
      nextStep: 'body',
      title: titleResult.titleSeen,
      previousTitle: args.title ? undefined : getTitleText(),
      pageId: getCurrentPageId(),
      url: location.href.split('?')[0],
      hint: 'Title updated. Re-run the same command to update the body.',
      action: 'retry same command'
    };
  }

  if (activeStep === 'body') {
    var bodyResult = writeBodySync(getTitleEditor(), paragraphs, mode);
    if (!bodyResult.ok) return bodyResult;
    return {
      title: bodyResult.title,
      content: content,
      mode: mode,
      paragraphCount: bodyResult.paragraphCount,
      bodyCharacterCount: bodyResult.bodyCharacterCount,
      bodyPreview: bodyResult.bodyPreview,
      pageId: getCurrentPageId(),
      url: location.href.split('?')[0],
      edited: true,
      step: 'body'
    };
  }

  return await navigateToPage();
}
