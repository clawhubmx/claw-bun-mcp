/* @meta
{
  "name": "grok/health",
  "description": "Check Grok chat access: login, Cloudflare, rate limits, submit state, API reachability",
  "domain": "grok.com",
  "args": {},
  "capabilities": ["network"],
  "readOnly": true,
  "example": "bun-browser site grok/health"
}
*/

async function(args) {
  function hasCookie(name) {
    return document.cookie.split(';').some(function(c) {
      return c.trim().startsWith(name + '=');
    });
  }

  if (!hasCookie('sso') && !hasCookie('x-userid')) {
    return {
      ok: false,
      error: 'Not logged in',
      hint: '需要先在浏览器中登录 grok.com（X/xAI 账号）',
      action: 'bun-browser open https://grok.com/'
    };
  }

  var h = globalThis.__grokChatHelpers;
  if (h && h.version === 15 && h.detectGrokPageAbnormal) {
    var cachedAbnormal = h.detectGrokPageAbnormal();
    if (cachedAbnormal) {
      cachedAbnormal.ok = false;
      return cachedAbnormal;
    }
  } else {
    function getVisiblePageText(maxLen) {
      maxLen = maxLen || 12000;
      var text = (document.body && (document.body.innerText || document.body.textContent)) || '';
      return text.length > maxLen ? text.slice(0, maxLen) : text;
    }

    function detectCloudflareBlock() {
      if (document.querySelector(
        '.cf-turnstile, #challenge-running, #cf-challenge-running, #cf-wrapper, ' +
        'iframe[src*="challenges.cloudflare"], iframe[src*="turnstile"], ' +
        'form[action*="cdn-cgi/challenge"]'
      )) return true;
      var title = (document.title || '').toLowerCase();
      if (/just a moment|attention required|cloudflare|please wait|verify you are human/i.test(title)) return true;
      var text = getVisiblePageText(4000);
      if (!document.querySelector('[data-testid="chat-input"]') &&
        /verify you are human|checking if the site connection is secure|cf-browser-verification|ddos protection by cloudflare/i.test(text)) {
        return true;
      }
      return false;
    }

    function detectRateLimitText(text) {
      if (/minutes?\s+before\s+limit\s+is\s+gone/i.test(text)) return true;
      if (/you can continue chatting once it resets/i.test(text)) return true;
      if (/message\s+limit\s+reached/i.test(text)) return true;
      if (/rate\s+limit/i.test(text) && /reset|wait|try again|minutes?/i.test(text)) return true;
      if (/too many (messages|requests)/i.test(text)) return true;
      return false;
    }

    if (detectCloudflareBlock()) {
      return {
        ok: false,
        error: 'Cloudflare verification required',
        kind: 'cloudflare',
        hint: 'Cloudflare bot/challenge page detected. Open grok.com in the browser and complete verification manually.',
        action: 'bun-browser open https://grok.com/'
      };
    }

    var pageText = getVisiblePageText();
    if (detectRateLimitText(pageText)) {
      var m = pageText.match(/(\d+)\s*minutes?\s+before\s+limit\s+is\s+gone/i);
      var rateOut = {
        ok: false,
        error: 'Chat rate limit reached',
        kind: 'rate_limit',
        hint: m
          ? 'Rate limit active: about ' + Number(m[1]) + ' minutes until reset.'
          : 'Rate limit or quota message detected on page.',
        action: 'wait for limit reset, then retry'
      };
      if (m) rateOut.minutesUntilReset = Number(m[1]);
      return rateOut;
    }
  }

  function getSubmitButton() {
    var buttons = Array.prototype.slice.call(document.querySelectorAll('button'));
    return buttons.find(function(b) {
      return (b.getAttribute('aria-label') || '').toLowerCase() === 'submit';
    }) || null;
  }

  var chatInput = !!document.querySelector('[data-testid="chat-input"]');
  var submitBtn = (h && h.getSubmitButton) ? h.getSubmitButton() : getSubmitButton();
  var submitEnabled = !!(submitBtn && !submitBtn.disabled && submitBtn.getAttribute('aria-disabled') !== 'true');

  if (submitBtn && !submitEnabled) {
    return {
      ok: false,
      error: 'Chat submission blocked',
      kind: 'submit_disabled',
      hint: 'Submit button is disabled — often due to rate limits or account restrictions.',
      action: 'bun-browser open https://grok.com/',
      login: true,
      chatInput: chatInput,
      submitEnabled: false
    };
  }

  var modesReachable = false;
  try {
    var resp = await fetch('/rest/modes', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: '{}'
    });
    if (resp.ok) {
      modesReachable = true;
    } else {
      var errText = '';
      try { errText = await resp.text(); } catch (e) {}
      if (resp.status === 403 || errText.indexOf('anti-bot') !== -1) {
        return {
          ok: false,
          error: 'Anti-bot verification required',
          kind: 'anti_bot',
          hint: 'Grok API rejected the request. Complete verification in the browser.',
          action: 'bun-browser open https://grok.com/',
          login: true,
          chatInput: chatInput,
          submitEnabled: submitEnabled
        };
      }
      if (resp.status === 429) {
        return {
          ok: false,
          error: 'Rate limit reached',
          kind: 'rate_limit',
          hint: 'Grok API rate limit (HTTP 429). Wait before retrying.',
          action: 'wait and retry',
          login: true,
          chatInput: chatInput,
          submitEnabled: submitEnabled
        };
      }
      if (resp.status === 502 || resp.status === 503) {
        return {
          ok: false,
          error: 'Service unavailable',
          kind: 'service_unavailable',
          hint: 'Grok API temporarily unavailable (HTTP ' + resp.status + ').',
          action: 'retry later',
          login: true,
          chatInput: chatInput,
          submitEnabled: submitEnabled
        };
      }
      return {
        ok: false,
        error: 'HTTP ' + resp.status,
        kind: 'api_error',
        hint: 'Grok /rest/modes request failed.',
        action: 'bun-browser open https://grok.com/',
        login: true,
        chatInput: chatInput,
        submitEnabled: submitEnabled
      };
    }
  } catch (e) {
    return {
      ok: false,
      error: 'Network error',
      kind: 'network_error',
      hint: 'Could not reach Grok API from browser tab.',
      action: 'bun-browser open https://grok.com/',
      login: true,
      chatInput: chatInput,
      submitEnabled: submitEnabled
    };
  }

  return {
    ok: true,
    login: true,
    chatInput: chatInput,
    submitEnabled: submitEnabled,
    modesReachable: modesReachable,
    url: location.href,
    hint: chatInput
      ? (submitEnabled ? 'Grok chat appears accessible.' : 'Chat input present but submit is disabled.')
      : 'Logged in but chat input not found — open grok.com chat page.'
  };
}
