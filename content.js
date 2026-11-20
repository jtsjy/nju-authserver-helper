(() => {
  const LOGIN_PATH = "/authserver/login";
  const COOLDOWN_MS = 45 * 1000;
  const FALLBACK_DELAYS = [120, 500, 1200];
  let settings = null;
  let injectCount = 0;
  let captchaSeen = false;
  let toastTimer = null;

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  function isLoginPage() {
    return location.pathname.indexOf(LOGIN_PATH) === 0;
  }

  function isVisible(el) {
    if (!el) return false;
    const rect = el.getBoundingClientRect();
    if (!rect.width || !rect.height) return false;
    const style = getComputedStyle(el);
    return style.visibility !== "hidden" && style.display !== "none" && style.opacity !== "0";
  }

  function captchaVisible() {
    const el = document.getElementById("captcha-id");
    return !!(el && isVisible(el));
  }

  function hasVisibleError() {
    const nodes = document.querySelectorAll("#showErrorTip, .item-error-tip, .text-danger");
    for (let i = 0; i < nodes.length; i += 1) {
      if (nodes[i].textContent.trim() && isVisible(nodes[i])) return true;
    }
    return false;
  }

  // 页面里同时存在手机号登录和账号密码登录两份 #username，
  // 必须优先选可见的 .m-account 表单，不能拿全局第一个隐藏字段。
  function findAccountField(id) {
    const scoped = document.querySelector(".login-main .m-account #" + id);
    if (scoped && isVisible(scoped)) return scoped;
    const nodes = document.querySelectorAll("#" + id);
    for (let i = 0; i < nodes.length; i += 1) {
      if (isVisible(nodes[i])) return nodes[i];
    }
    return scoped || nodes[0] || null;
  }

  function normalizeSettings(data) {
    data.rememberPassword = !!data.rememberPassword;
    data.autoFill = !!data.autoFill && data.rememberPassword;
    data.autoLogin = data.autoFill;
    data.solver = !!data.solver && data.autoFill;
    data.silent = !!data.silent && data.solver;
    return data;
  }

  async function loadSettings() {
    return normalizeSettings(await chrome.storage.local.get({
      username: "",
      password: "",
      rememberPassword: true,
      autoFill: true,
      autoLogin: true,
      solver: true,
      silent: true
    }));
  }

  function setInputValue(input, value, force) {
    if (!input || !value) return false;
    if (input.value && !force) return false;
    const proto = Object.getPrototypeOf(input);
    const descriptor = Object.getOwnPropertyDescriptor(proto, "value");
    if (descriptor && descriptor.set) {
      descriptor.set.call(input, value);
    } else {
      input.value = value;
    }
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
    input.dispatchEvent(new KeyboardEvent("keyup", { bubbles: true, key: "a" }));
    return true;
  }

  function showToast(message) {
    let toast = document.getElementById("nju-helper-toast");
    if (!toast) {
      toast = document.createElement("div");
      toast.id = "nju-helper-toast";
      toast.style.cssText = [
        "position:fixed",
        "right:20px",
        "bottom:20px",
        "z-index:2147483647",
        "padding:10px 14px",
        "border-radius:10px",
        "background:#4b1f73",
        "color:#fff",
        "font:14px/1.5 system-ui,-apple-system,'Segoe UI','Microsoft YaHei',sans-serif",
        "box-shadow:0 8px 24px rgba(30,10,50,.28)",
        "opacity:0",
        "transform:translateY(6px)",
        "transition:opacity .18s ease,transform .18s ease",
        "pointer-events:none",
        "max-width:320px"
      ].join(";");
      document.documentElement.appendChild(toast);
    }
    toast.textContent = message;
    requestAnimationFrame(() => {
      toast.style.opacity = "1";
      toast.style.transform = "translateY(0)";
    });
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      toast.style.opacity = "0";
      toast.style.transform = "translateY(6px)";
    }, 2600);
  }

  async function injectSolver() {
    if (injectCount >= FALLBACK_DELAYS.length) return;
    injectCount += 1;
    if (!settings) settings = await loadSettings();
    if (!settings || !settings.solver) return;
    const file = settings.silent
      ? "longbow.slidercaptcha.silent.js"
      : "longbow.slidercaptcha.auto.js";
    const script = document.createElement("script");
    script.src = chrome.runtime.getURL(file) + "?t=" + Date.now();
    script.onload = () => script.remove();
    script.onerror = () => {
      script.remove();
      console.warn("[NJU 助手] 滑块脚本注入失败，可能被页面 CSP 拦截");
    };
    (document.head || document.documentElement).appendChild(script);
  }

  function scheduleSolverFallback() {
    FALLBACK_DELAYS.forEach((delay) => setTimeout(injectSolver, delay));
  }

  function watchCaptcha() {
    let observer = null;
    const check = () => {
      if (captchaVisible() && !captchaSeen) {
        captchaSeen = true;
        if (observer) observer.disconnect();
        scheduleSolverFallback();
      }
    };
    check();
    if (!captchaSeen) {
      observer = new MutationObserver(check);
      observer.observe(document.documentElement, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ["style", "class"]
      });
    }
  }

  async function ensureRule() {
    return new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage({ type: "ensure-rule" }, (response) => {
          resolve(response || { ok: false });
        });
      } catch (error) {
        resolve({ ok: false, error: String(error) });
      }
    });
  }

  async function autoLogin(frame) {
    try {
      if (!isLoginPage()) return { ok: false, reason: "not-login-page" };
      settings = await loadSettings();
      if (!settings.autoFill && !settings.autoLogin) {
        return { ok: false, reason: "disabled" };
      }

      let username = null;
      let password = null;
      let fieldsReady = false;
      for (let i = 0; i < 40; i += 1) {
        username = findAccountField("username");
        password = findAccountField("password");
        if (username && password && isVisible(username) && isVisible(password)) {
          fieldsReady = true;
          break;
        }
        await sleep(100);
      }
      if (!fieldsReady || !username || !password) {
        return { ok: false, reason: "no-visible-fields" };
      }

      const existingUser = (username.value || "").trim();
      if (!frame.force && existingUser && settings.username &&
          existingUser !== settings.username.trim()) {
        return { ok: false, reason: "username-mismatch" };
      }

      let didFill = false;
      if (settings.autoFill) {
        if (!username.value || frame.force) {
          didFill = setInputValue(username, settings.username, true) || didFill;
        }
        if (settings.rememberPassword && (!password.value || frame.force)) {
          didFill = setInputValue(password, settings.password, true) || didFill;
        }
        if (didFill && frame.notify) {
          showToast("已填入统一认证账号");
        }
      }

      if (!settings.autoLogin) return { ok: true, clicked: false, reason: "auto-login-off" };
      if (!username.value || !password.value) return { ok: false, reason: "need-password" };
      if (captchaVisible()) return { ok: true, clicked: false, reason: "captcha-already-open" };
      if (hasVisibleError() && !frame.force) return { ok: false, reason: "page-error" };

      const last = Number(sessionStorage.getItem("nju-helper-last-login") || 0);
      if (!frame.force && Date.now() - last < COOLDOWN_MS) {
        return { ok: false, reason: "cooldown" };
      }
      sessionStorage.setItem("nju-helper-last-login", String(Date.now()));

      await ensureRule();
      await sleep(250);
      chrome.runtime.sendMessage({ type: "auto-login" }, () => {
        if (chrome.runtime.lastError) {
          // 后台服务未响应时保留页面注入兜底，不中断页面
        }
      });
      scheduleSolverFallback();
      if (frame.notify) showToast("正在自动登录…");
      return { ok: true, clicked: true };
    } catch (error) {
      return { ok: false, reason: String(error) };
    }
  }

  watchCaptcha();

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    const relevant = ["rememberPassword", "autoFill", "solver", "silent"];
    if (relevant.some((key) => changes[key])) {
      loadSettings().then((data) => {
        settings = data;
      });
    }
  });

  // 关闭自动填充但开启自动登录时，用户手动输完账号/密码（change/回车）后也自动按登录
  document.addEventListener(
    "change",
    (event) => {
      const target = event.target;
      if (!target || (target.id !== "username" && target.id !== "password")) return;
      setTimeout(() => autoLogin({ force: false, notify: false }), 200);
    },
    true
  );
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message && message.type === "fill-now") {
      autoLogin({ force: true, notify: true }).then(sendResponse);
      return true;
    }
    if (message && message.type === "status") {
      sendResponse({
        loginPage: isLoginPage(),
        hasFields: !!(findAccountField("username") && findAccountField("password")),
        captcha: captchaVisible()
      });
      return;
    }
  });

  autoLogin({ force: false, notify: true });
})();
