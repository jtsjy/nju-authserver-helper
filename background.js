const RULE_ID = 1;
const SCRIPT_PREFIX =
  "||authserver.nju.edu.cn/authserver/njuTheme/static/js/plugin/sliderCaptcha/js/longbow.slidercaptcha.js";

async function applyRedirectRule() {
  const settings = await chrome.storage.local.get({
    silent: true,
    solver: true,
    autoFill: true,
    rememberPassword: true
  });
  const fillEnabled = !!settings.autoFill && !!settings.rememberPassword;
  const solverEnabled = !!settings.solver && fillEnabled;
  if (!solverEnabled) {
    try {
      await chrome.declarativeNetRequest.updateDynamicRules({
        removeRuleIds: [RULE_ID]
      });
      console.log("[NJU 助手] 滑块接管已关闭（依赖未满足）");
      return { ok: true, target: null };
    } catch (error) {
      console.error("[NJU 助手] 关闭滑块重定向失败", error);
      return { ok: false, error: String(error) };
    }
  }
  const target = (!!settings.silent && solverEnabled)
    ? "/longbow.slidercaptcha.silent.js"
    : "/longbow.slidercaptcha.auto.js";
  try {
    await chrome.declarativeNetRequest.updateDynamicRules({
      removeRuleIds: [RULE_ID],
      addRules: [
        {
          id: RULE_ID,
          priority: 1,
          action: {
            type: "redirect",
            redirect: { extensionPath: target }
          },
          condition: {
            // 不限制资源类型：jQuery 可能用 XHR 加载 <script src>，
            // 只按精确 URL 匹配即可，避免漏掉 script/xhr/fetch 的差异
            urlFilter: SCRIPT_PREFIX
          }
        }
      ]
    });
    console.log("[NJU 助手] 滑块脚本重定向 ->", target);
    return { ok: true, target };
  } catch (error) {
    console.error("[NJU 助手] 注册滑块重定向失败", error);
    return { ok: false, error: String(error) };
  }
}

chrome.runtime.onInstalled.addListener(() => {
  applyRedirectRule();
});
chrome.runtime.onStartup.addListener(() => {
  applyRedirectRule();
});
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" &&
      (changes.silent || changes.solver || changes.autoFill || changes.rememberPassword)) {
    applyRedirectRule();
  }
});
applyRedirectRule();

// 这段函数会被注入页面 MAIN world，可直接访问页面的 startLogin/needCaptcha。
function pageAutoLogin() {
  try {
    const isVisible = (el) => {
      if (!el) return false;
      const rect = el.getBoundingClientRect();
      if (!rect.width || !rect.height) return false;
      const style = getComputedStyle(el);
      return style.visibility !== "hidden" && style.display !== "none" && style.opacity !== "0";
    };
    // 手机号登录和账号密码登录各有一份 #username，优先取可见的 .m-account
    const findField = (id) => {
      const scoped = document.querySelector(".login-main .m-account #" + id);
      if (scoped && isVisible(scoped)) return scoped;
      const nodes = document.querySelectorAll("#" + id);
      for (let i = 0; i < nodes.length; i += 1) {
        if (isVisible(nodes[i])) return nodes[i];
      }
      return scoped || nodes[0] || null;
    };

    const username = findField("username");
    const password = findField("password");
    if (!username || !password || !username.value || !password.value) {
      return { ok: false, reason: "empty-credentials" };
    }
    if (sessionStorage.getItem("nju-helper-clicking") === "1") {
      return { ok: false, reason: "already-clicking" };
    }
    sessionStorage.setItem("nju-helper-clicking", "1");

    try {
      if (typeof checkUserCaptcha === "function") {
        checkUserCaptcha();
      }
    } catch (error) {
      // 忽略：仍继续点击登录
    }

    let tries = 0;
    const timer = setInterval(() => {
      tries += 1;
      let need = false;
      try {
        need = typeof needCaptcha !== "undefined" && !!needCaptcha;
      } catch (error) {
        need = false;
      }
      if (need || tries >= 20) {
        clearInterval(timer);
        const buttons = document.querySelectorAll(".login-main #login_submit");
        let button = null;
        for (let i = 0; i < buttons.length; i += 1) {
          if (isVisible(buttons[i])) {
            button = buttons[i];
            break;
          }
        }
        if (!button) {
          button =
            document.querySelector(".login-main .m-account #login_submit") ||
            document.querySelector(".login-main #login_submit") ||
            document.getElementById("login_submit");
        }
        if (button) {
          button.click();
        }
        sessionStorage.removeItem("nju-helper-clicking");
      }
    }, 150);
    return { ok: true };
  } catch (error) {
    try {
      sessionStorage.removeItem("nju-helper-clicking");
    } catch (ignored) {}
    return { ok: false, reason: String(error) };
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message && message.type === "ensure-rule") {
    applyRedirectRule().then(sendResponse);
    return true;
  }

  if (message && message.type === "auto-login") {
    const tabId = sender.tab && sender.tab.id;
    if (!tabId) {
      sendResponse({ ok: false, reason: "no-tab" });
      return;
    }
    chrome.scripting
      .executeScript({
        target: { tabId },
        world: "MAIN",
        func: pageAutoLogin
      })
      .then((results) => {
        sendResponse({
          ok: true,
          result: results && results[0] ? results[0].result : null
        });
      })
      .catch((error) => {
        sendResponse({ ok: false, reason: String(error) });
      });
    return true;
  }

  if (message && message.type === "rule-status") {
    chrome.declarativeNetRequest.getDynamicRules().then((rules) => {
      sendResponse({
        rule: rules.find((rule) => rule.id === RULE_ID) || null
      });
    });
    return true;
  }
});
