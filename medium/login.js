/* @meta
{
  "name": "medium/login",
  "description": "Medium 邮箱登录 (sign in with email, wait for confirmation code, optional auto-submit code)",
  "domain": "medium.com",
  "args": {
    "email": { "required": false, "description": "Email address (required to start sign-in)" },
    "operation": { "required": false, "description": "login or register (default: login)" },
    "fullName": { "required": false, "description": "Full name when operation=register" },
    "code": { "required": false, "description": "6-digit confirmation code from Medium email" },
    "timeoutMs": { "required": false, "description": "Max wait ms (default 120000)" },
    "pollMs": { "required": false, "description": "Poll interval ms (default 1000)" }
  },
  "readOnly": false,
  "example": "bun-browser site medium/login you@example.com register \"Your Name\""
}
*/

async function (args) {
  function sleep(ms) {
    return new Promise(function (resolve) {
      setTimeout(resolve, ms);
    });
  }

  function parseIntArg(val, fallback) {
    var n = parseInt(String(val == null || val === "" ? fallback : val), 10);
    return Number.isFinite(n) ? n : fallback;
  }

  function bodyText() {
    return (document.body && document.body.innerText) || "";
  }

  function clickButton(re) {
    var buttons = document.querySelectorAll("button");
    for (var i = 0; i < buttons.length; i++) {
      var text = (buttons[i].textContent || "").replace(/\s+/g, " ").trim();
      if (re.test(text)) {
        buttons[i].click();
        return text;
      }
    }
    return null;
  }

  function setInputValue(el, value) {
    if (!el) return false;
    el.focus();
    document.execCommand("selectAll", false, undefined);
    document.execCommand("insertText", false, String(value));
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  }

  function detectPhase() {
    var text = bodyText();
    var path = location.pathname;

    if (/\/m\/callback\/email/i.test(path)) return "callback";
    if (/check your email/i.test(text) && (/enter the code/i.test(text) || /magic link/i.test(text))) {
      return "code_form";
    }
    if (/didn't recognize that email|did not recognize that email/i.test(text)) return "unrecognized_email";
    if (/sign up with email/i.test(text)) return "signup_form";
    if (/sign in with email/i.test(text) && /your email/i.test(text)) return "email_form";
    if (/sign in with google|sign in with email|sign in with apple/i.test(text)) return "signin_options";
    return "unknown";
  }

  async function checkLoggedIn() {
    try {
      var resp = await fetch("/_/graphql", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify([
          {
            operationName: "CacheUnsafeLoggedInStateQuery",
            variables: {},
            query: "query CacheUnsafeLoggedInStateQuery { isLoggedIn }",
          },
        ]),
      });
      if (!resp.ok) return false;
      var data = await resp.json();
      return !!(data && data[0] && data[0].data && data[0].data.isLoggedIn);
    } catch (e) {
      return false;
    }
  }

  async function waitForLoggedIn(deadline, pollMs) {
    while (Date.now() < deadline) {
      if (await checkLoggedIn()) return true;
      if (!/\/m\/signin|\/m\/callback\/email/i.test(location.pathname)) {
        if (await checkLoggedIn()) return true;
      }
      await sleep(pollMs);
    }
    return await checkLoggedIn();
  }

  async function waitForPhase(phases, deadline, pollMs) {
    while (Date.now() < deadline) {
      var phase = detectPhase();
      for (var i = 0; i < phases.length; i++) {
        if (phase === phases[i]) return phase;
      }
      if (phases.indexOf("logged_in") >= 0 && (await checkLoggedIn()) && phase !== "code_form") {
        return "logged_in";
      }
      await sleep(pollMs);
    }
    return detectPhase();
  }

  function ensureSignInPage() {
    if (location.hostname !== "medium.com" && !location.hostname.endsWith(".medium.com")) {
      location.assign("https://medium.com/m/signin");
      return false;
    }
    if (!/\/m\/signin/i.test(location.pathname)) {
      location.assign("https://medium.com/m/signin");
      return false;
    }
    return true;
  }

  async function waitForSignInSurface(deadline, pollMs) {
    while (Date.now() < deadline) {
      var phase = detectPhase();
      if (
        /\/m\/signin/i.test(location.pathname) &&
        (phase === "signin_options" ||
          phase === "email_form" ||
          phase === "signup_form" ||
          phase === "code_form" ||
          phase === "unrecognized_email")
      ) {
        return true;
      }
      if (phase === "code_form") return true;
      await sleep(pollMs);
    }
    return (
      /\/m\/signin/i.test(location.pathname) &&
      detectPhase() !== "unknown"
    );
  }

  async function openEmailSignIn(operation) {
    var phase = detectPhase();
    if (phase === "email_form" || phase === "signup_form" || phase === "code_form") return phase;
    if (phase === "signin_options" || phase === "unknown") {
      if (operation === "register") {
        clickButton(/create a new account/i);
      } else {
        clickButton(/sign in with email/i);
      }
      await sleep(800);
    }
    return detectPhase();
  }

  async function submitEmail(email, operation, fullName) {
    var phase = await openEmailSignIn(operation);
    if (phase === "code_form") {
      return { ok: true, phase: "code_form", alreadySent: true };
    }

    if (phase === "signup_form" && operation === "login") {
      clickButton(/^sign in$/i);
      await sleep(800);
      phase = detectPhase();
    }

    if (phase === "signup_form" || operation === "register") {
      if (!fullName) fullName = "Medium User";
      setInputValue(document.querySelector('input[type="text"]'), fullName);
    }

    var emailInput = document.querySelector('input[type="email"]');
    if (!emailInput) {
      clickButton(/sign in with email/i);
      await sleep(800);
      emailInput = document.querySelector('input[type="email"]');
    }
    if (!emailInput) {
      return { ok: false, error: "Email field not found", phase: detectPhase() };
    }

    setInputValue(emailInput, email);
    await sleep(300);

    var clicked =
      operation === "register"
        ? clickButton(/^create account$/i)
        : clickButton(/^continue$/i);

    if (!clicked) {
      return { ok: false, error: "Continue / Create account button not found", phase: detectPhase() };
    }

    await sleep(2500);
    phase = detectPhase();

    if (phase === "unrecognized_email" && operation === "login") {
      return {
        ok: false,
        error: "Email not recognized",
        phase: phase,
        hint: "该邮箱未注册 Medium。请用已注册邮箱登录，或使用: bun-browser site medium/login " + JSON.stringify(email) + " register \"Your Name\"",
        action: "bun-browser site medium/login " + JSON.stringify(email) + " register \"Your Name\"",
      };
    }

    if (phase === "code_form") {
      return { ok: true, phase: "code_form" };
    }

    return { ok: false, error: "Confirmation code step did not appear", phase: phase, bodyPreview: bodyText().slice(0, 300) };
  }

  function codeInputs() {
    return Array.prototype.slice
      .call(document.querySelectorAll("input"))
      .filter(function (i) {
        if (i.type === "checkbox" || i.type === "hidden") return false;
        if (i.name === "g-recaptcha-response") return false;
        return true;
      });
  }

  async function submitCode(code) {
    var digits = String(code).replace(/\D/g, "");
    if (digits.length < 4) {
      return { ok: false, error: "Invalid code", hint: "Medium 验证码通常为 6 位数字。" };
    }

    var phase = detectPhase();
    if (phase !== "code_form") {
      return {
        ok: false,
        error: "Not on confirmation code step",
        phase: phase,
        hint: "请先运行 bun-browser site medium/login <email> 触发验证码邮件。",
      };
    }

    var inputs = codeInputs();
    if (inputs.length >= digits.length) {
      for (var i = 0; i < digits.length; i++) {
        setInputValue(inputs[i], digits.charAt(i));
        await sleep(80);
      }
    } else if (inputs.length === 1) {
      setInputValue(inputs[0], digits);
    } else if (inputs.length > 0) {
      setInputValue(inputs[0], digits);
      for (var j = 1; j < inputs.length && j < digits.length; j++) {
        setInputValue(inputs[j], digits.charAt(j));
        await sleep(80);
      }
    } else {
      return { ok: false, error: "Code input fields not found" };
    }

    await sleep(400);
    var submitted = clickButton(/^submit$/i);
    if (!submitted) {
      return { ok: false, error: "Submit button not found on code form" };
    }

    return { ok: true };
  }

  function extractEmailFromCodeForm() {
    var match = bodyText().match(/sent to:\s*\n?\s*([^\s\n]+@[^\s\n]+)/i);
    return match ? match[1] : null;
  }

  var pollMs = Math.max(250, parseIntArg(args.pollMs, 1000));
  var timeoutMs = Math.max(pollMs * 2, parseIntArg(args.timeoutMs, 120000));
  var deadline = Date.now() + timeoutMs;
  var operation = String(args.operation || "login").toLowerCase();
  if (operation !== "login" && operation !== "register") operation = "login";

  var email = args.email != null && String(args.email).trim() !== "" ? String(args.email).trim() : "";
  var code = args.code != null && String(args.code).trim() !== "" ? String(args.code).replace(/\D/g, "") : "";
  if (code && !/^\d{6}$/.test(code)) code = "";

  // bun-browser CLI strips unknown --flags; a lone 6-digit positional is the verification code.
  if (email && !code && /^\d{6}$/.test(email)) {
    code = email;
    email = "";
  }

  if (await checkLoggedIn() && !email && !code) {
    return {
      status: "logged_in",
      signInMethod: "email",
      url: location.href,
      hint: "Already logged in to Medium.",
    };
  }

  function isOnSignInSurface() {
    var phase = detectPhase();
    return (
      /\/m\/signin/i.test(location.pathname) &&
      (phase === "signin_options" ||
        phase === "email_form" ||
        phase === "signup_form" ||
        phase === "code_form" ||
        phase === "unrecognized_email")
    );
  }

  if (await checkLoggedIn() && email && !code && !isOnSignInSurface()) {
    return {
      error: "Already logged in",
      hint:
        "当前 Chrome 已登录 Medium。请先在浏览器 Sign out，或打开并保持 medium.com/m/signin 标签页后重试。",
      action: "bun-browser open https://medium.com/m/signin",
    };
  }

  if (detectPhase() === "callback") {
    var callbackLoggedIn = await waitForLoggedIn(deadline, pollMs);
    if (callbackLoggedIn) {
      return { status: "logged_in", signInMethod: "email", url: location.href, via: "callback" };
    }
  }

  if (!email && !code) {
    return {
      error: "Missing argument: email",
      hint: "提供邮箱以开始 Sign in with email；若已收到验证码，可只传 6 位数字。",
      action: "bun-browser site medium/login you@example.com",
    };
  }

  if (!ensureSignInPage() && !isOnSignInSurface()) {
    await sleep(2000);
    if (!(await waitForSignInSurface(deadline, pollMs))) {
      if (await checkLoggedIn()) {
        return {
          error: "Already logged in",
          hint: "当前 Chrome 已登录 Medium，无法在同一 session 中再次走邮箱登录。请先在浏览器中 Sign out，或换未登录的 profile。",
          action: "bun-browser open https://medium.com/me/settings",
        };
      }
      return {
        error: "Redirecting to sign-in page",
        hint: "正在打开 medium.com/m/signin，加载完成后请再次运行同一命令。",
        action: "bun-browser site medium/login " + JSON.stringify(email || "you@example.com"),
      };
    }
  }

  if (code) {
    var codeResult = await submitCode(code);
    if (!codeResult.ok) return codeResult;

    var loggedInAfterCode = await waitForLoggedIn(deadline, pollMs);
    if (loggedInAfterCode) {
      return {
        status: "logged_in",
        signInMethod: "email",
        email: email || extractEmailFromCodeForm(),
        url: location.href,
      };
    }

    return {
      status: "awaiting_login",
      error: "Code submitted but login not confirmed yet",
      hint: "验证码已提交；若页面跳转到 Cloudflare 或 callback，请稍等后重试 medium/login（无参数）或刷新页面。",
      phase: detectPhase(),
      url: location.href,
      action: "bun-browser site medium/login " + JSON.stringify(code),
    };
  }

  if (!email) {
    return {
      error: "Missing argument: email",
      hint: "首次登录需要邮箱；收到验证码后用 bun-browser site medium/login 123456 完成登录。",
    };
  }

  var sendResult = await submitEmail(email, operation, args.fullName != null ? String(args.fullName) : "");
  if (!sendResult.ok) return sendResult;

  var afterSendPhase = await waitForPhase(["code_form"], deadline, pollMs);
  if (afterSendPhase === "code_form") {
    // fall through to awaiting_code below
  } else if (afterSendPhase === "logged_in" || ((await checkLoggedIn()) && detectPhase() !== "code_form")) {
    return { status: "logged_in", signInMethod: "email", email: email, url: location.href };
  } else if (afterSendPhase !== "code_form") {
    return {
      error: "Timed out waiting for confirmation code step",
      phase: afterSendPhase,
      email: email,
      hint: "未出现验证码输入页。请确认邮箱正确、Medium 未限流，或在 Chrome 中手动完成登录。",
      action: "bun-browser open https://medium.com/m/signin",
    };
  }

  var waitedLoggedIn = await waitForLoggedIn(deadline, pollMs);
  if (waitedLoggedIn && detectPhase() !== "code_form") {
    return {
      status: "logged_in",
      signInMethod: "email",
      email: email,
      url: location.href,
      hint: "Logged in (code entered manually in browser).",
    };
  }

  return {
    status: "awaiting_code",
    signInMethod: "email",
    email: email,
    phase: "code_form",
    hint: "验证码已发送到邮箱。查收邮件后运行: bun-browser site medium/login 123456",
    action: "bun-browser site medium/login YOUR_CODE",
    url: location.href,
  };
}
