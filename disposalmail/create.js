/* @meta
{
  "name": "disposalmail/create",
  "description": "Create a disposable temp email on Disposalmail (fresh random or custom alias)",
  "domain": "www.disposalmail.com",
  "args": {
    "name": {"required": false, "description": "Custom email alias (local part before @)"},
    "domain": {"required": false, "description": "Email domain (default: disposalmail.com)"}
  },
  "capabilities": ["network"],
  "readOnly": false,
  "example": "bun-browser site disposalmail/create"
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

  function formatResult(res) {
    if (!res?.mailbox) {
      return {
        error: 'Unexpected response',
        hint: 'Disposalmail did not return a mailbox address'
      };
    }

    const messages = res.messages || [];
    return {
      email: res.mailbox,
      token: res.email_token,
      inbox_url: location.origin + '/go-to-email/' + res.email_token,
      domain: res.mailbox.split('@')[1],
      message_count: messages.length,
      messages: messages.map((m, i) => ({
        rank: i + 1,
        id: m.id,
        from: m.from,
        from_email: m.from_email,
        subject: m.subject,
        received_at: m.receivedAt,
        is_seen: m.is_seen,
        url: location.origin + '/view/' + m.id
      }))
    };
  }

  if (args.name) {
    const { ok, status, body } = await post('/change', {
      _token: token,
      name: args.name,
      domain: args.domain || 'disposalmail.com'
    });

    if (!ok) {
      return {
        error: 'HTTP ' + status,
        hint: formatErrors(body) || 'Failed to create custom email address'
      };
    }

    return formatResult(body);
  }

  const deleteResult = await post('/delete', { _token: token });
  if (!deleteResult.ok && deleteResult.status !== 404) {
    return {
      error: 'HTTP ' + deleteResult.status,
      hint: formatErrors(deleteResult.body) || 'Failed to delete current mailbox'
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
      hint: formatErrors(body) || 'Failed to create random email address'
    };
  }

  return formatResult(body);
}
