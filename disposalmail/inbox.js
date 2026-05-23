/* @meta
{
  "name": "disposalmail/inbox",
  "description": "Check Disposalmail inbox; optionally read message by index (0 = latest)",
  "domain": "www.disposalmail.com",
  "args": {
    "index": {"required": false, "description": "0-based message index after sorting newest-first (0 = latest)"}
  },
  "capabilities": ["network"],
  "readOnly": true,
  "example": "bun-browser site disposalmail/inbox 0"
}
*/

async function(args) {
  const token = document.querySelector('meta[name="csrf-token"]')?.content;
  if (!token) {
    return {
      error: 'Missing CSRF token',
      hint: 'Open disposalmail.com in the browser first',
      action: 'bun-browser open https://www.disposalmail.com/'
    };
  }

  async function post(path, data) {
    const resp = await fetch(path, {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
        'X-Requested-With': 'XMLHttpRequest',
        'X-CSRF-TOKEN': token
      },
      body: JSON.stringify(data)
    });

    let body;
    try {
      body = await resp.json();
    } catch {
      body = null;
    }

    return { ok: resp.ok, status: resp.status, body };
  }

  function formatErrors(body) {
    if (!body?.errors) return body?.message || null;
    const messages = [];
    for (const field in body.errors) {
      if (Object.prototype.hasOwnProperty.call(body.errors, field)) {
        for (const msg of body.errors[field]) messages.push(msg);
      }
    }
    return messages.join('; ') || null;
  }

  function stripHtml(html) {
    return (html || '')
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&amp;/g, '&')
      .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n, 10)))
      .replace(/\s+/g, ' ')
      .trim();
  }

  async function fetchMessageBody(messageId) {
    const resp = await fetch('/view/' + messageId, {
      credentials: 'include',
      redirect: 'follow'
    });

    if (!resp.ok) {
      return {
        error: 'HTTP ' + resp.status,
        hint: 'Failed to load message view page'
      };
    }

    const html = await resp.text();
    const doc = new DOMParser().parseFromString(html, 'text/html');

    const iframe = doc.querySelector('#myContent, iframe[id="myContent"], iframe.mail-content, iframe');
    let bodyHtml = '';

    if (iframe) {
      bodyHtml = iframe.getAttribute('srcdoc') || '';
      if (!bodyHtml && iframe.getAttribute('src')) {
        const src = iframe.getAttribute('src');
        const iframeUrl = src.startsWith('http') ? src : new URL(src, location.origin).href;
        if (iframeUrl.startsWith(location.origin)) {
          const iframeResp = await fetch(iframeUrl, { credentials: 'include' });
          if (iframeResp.ok) bodyHtml = await iframeResp.text();
        }
      }
    }

    if (!bodyHtml) {
      const content =
        doc.querySelector('.mail-content, .message-content, .message-body, .mailbox-body') ||
        doc.querySelector('main');
      bodyHtml = content ? content.innerHTML : '';
    }

    if (!bodyHtml) {
      return {
        error: 'Message not found',
        hint: 'Could not extract message body from view page'
      };
    }

    return {
      body_html: bodyHtml,
      body_text: stripHtml(bodyHtml)
    };
  }

  const captcha = document.getElementById('captcha-response')?.value || '';
  const { ok, status, body } = await post('/get_messages', {
    _token: token,
    captcha: captcha
  });

  if (!ok) {
    return {
      error: 'HTTP ' + status,
      hint: formatErrors(body) || 'Failed to fetch inbox messages'
    };
  }

  if (!body?.mailbox) {
    return {
      error: 'Unexpected response',
      hint: 'Disposalmail did not return a mailbox address'
    };
  }

  const sorted = (body.messages || []).slice().sort((a, b) => {
    const ta = new Date(a.receivedAt || 0).getTime();
    const tb = new Date(b.receivedAt || 0).getTime();
    return tb - ta;
  });

  const messages = sorted.map((m, i) => ({
    index: i,
    id: m.id,
    from: m.from,
    from_email: m.from_email,
    subject: m.subject,
    received_at: m.receivedAt,
    is_seen: m.is_seen,
    url: location.origin + '/view/' + m.id
  }));

  const result = {
    email: body.mailbox,
    token: body.email_token,
    inbox_url: location.origin + '/go-to-email/' + body.email_token,
    count: messages.length,
    messages: messages
  };

  if (args.index === undefined || args.index === null || args.index === '') {
    return result;
  }

  const index = parseInt(args.index, 10);
  if (Number.isNaN(index)) {
    return {
      error: 'Invalid index',
      hint: 'Index must be a number (0 = latest message)'
    };
  }

  if (messages.length === 0) {
    return {
      error: 'Inbox empty',
      hint: 'No messages received yet for ' + body.mailbox
    };
  }

  if (index < 0 || index >= messages.length) {
    return {
      error: 'Index out of range',
      hint: 'Valid range: 0..' + (messages.length - 1) + ' (0 = latest)'
    };
  }

  const selected = messages[index];
  const bodyResult = await fetchMessageBody(selected.id);
  if (bodyResult.error) {
    return {
      ...result,
      error: bodyResult.error,
      hint: bodyResult.hint
    };
  }

  result.selected = {
    ...selected,
    body_html: bodyResult.body_html,
    body_text: bodyResult.body_text
  };

  return result;
}
