const LOGIN_URL = "https://authserver.nju.edu.cn/authserver/login";
const DEFAULTS = {
  username: "",
  password: "",
  rememberPassword: true,
  autoFill: true,
  solver: true,
  silent: true
};

const $ = (id) => document.getElementById(id);
const usernameInput = $("username");
const passwordInput = $("password");
const rememberInput = $("rememberPassword");
const autoFillInput = $("autoFill");
const solverInput = $("solver");
const silentInput = $("silent");
const statusDot = $("statusDot");
const statusText = $("statusText");
const feedback = $("feedback");
const engineEl = $("engine");
const flowEl = $("flow");
const rows = {
  autoFill: $("rowAutoFill"),
  solver: $("rowSolver"),
  silent: $("rowSilent")
};

function setFeedback(text, isError) {
  feedback.textContent = text || "";
  feedback.classList.toggle("error", !!isError);
}

function setStatus(text, level) {
  statusText.textContent = text;
  statusDot.className = "dot" + (level ? " " + level : "");
}

function setRowDisabled(row, disabled) {
  if (!row) return;
  row.classList.toggle("disabled", !!disabled);
}

function syncPasswordState() {
  const remember = rememberInput.checked;
  passwordInput.disabled = !remember;
  if (!remember) passwordInput.value = "";
}

// 依赖链：保存密码 → 自动填充并登录 → 自动完成滑块 → 静默完成滑块
// 前一项关闭时，后一项自动关闭并变灰。
function syncDependencyState() {
  let changed = false;
  if (!rememberInput.checked && autoFillInput.checked) {
    autoFillInput.checked = false;
    changed = true;
  }
  if (!autoFillInput.checked) {
    if (solverInput.checked) {
      solverInput.checked = false;
      changed = true;
    }
    if (silentInput.checked) {
      silentInput.checked = false;
      changed = true;
    }
  } else if (!solverInput.checked && silentInput.checked) {
    silentInput.checked = false;
    changed = true;
  }

  autoFillInput.disabled = !rememberInput.checked;
  solverInput.disabled = !rememberInput.checked || !autoFillInput.checked;
  silentInput.disabled = !rememberInput.checked || !autoFillInput.checked || !solverInput.checked;

  setRowDisabled(rows.autoFill, autoFillInput.disabled);
  setRowDisabled(rows.solver, solverInput.disabled);
  setRowDisabled(rows.silent, silentInput.disabled);
  updateFlow();
  return changed;
}

function updateFlow() {
  const save = rememberInput.checked;
  const fill = save && autoFillInput.checked;
  const solver = fill && solverInput.checked;
  const silent = solver && silentInput.checked;
  let text;
  if (!save) {
    text = "当前：不保存账号，全部手动";
  } else if (!fill) {
    text = "当前：仅保存账号，手动登录";
  } else if (!solver) {
    text = "当前：自动登录，滑块手动";
  } else {
    text = silent
      ? "当前：全自动（自动登录 + 静默滑块）"
      : "当前：全自动（自动登录 + 可见滑块）";
  }
  flowEl.textContent = text;
}

async function persistBehavior() {
  await chrome.storage.local.set({
    rememberPassword: rememberInput.checked,
    autoFill: autoFillInput.checked,
    autoLogin: autoFillInput.checked,
    solver: solverInput.checked,
    silent: silentInput.checked
  });
}

async function loadSettings() {
  const data = await chrome.storage.local.get(DEFAULTS);
  usernameInput.value = data.username || "";
  passwordInput.value = data.rememberPassword ? data.password || "" : "";
  rememberInput.checked = !!data.rememberPassword;
  autoFillInput.checked = !!data.autoFill;
  solverInput.checked = !!data.solver;
  silentInput.checked = !!data.silent;

  syncPasswordState();
  const changed = syncDependencyState();
  if (!rememberInput.checked && data.password) {
    await chrome.storage.local.set({ password: "" });
  }
  if (changed) {
    await persistBehavior();
  }
  if (!usernameInput.value) {
    usernameInput.focus();
  }
}

async function saveSettings(notify) {
  syncDependencyState();
  const remember = rememberInput.checked;
  await chrome.storage.local.set({
    username: usernameInput.value.trim(),
    password: remember ? passwordInput.value : "",
    rememberPassword: remember,
    autoFill: autoFillInput.checked,
    autoLogin: autoFillInput.checked,
    solver: solverInput.checked,
    silent: silentInput.checked
  });
  updateFlow();
  if (notify) setFeedback("已保存设置");
}

function queryActiveTab(callback) {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    callback(tabs && tabs[0] ? tabs[0] : null);
  });
}

function refreshRule() {
  const enabled = rememberInput.checked && autoFillInput.checked && solverInput.checked;
  if (!enabled) {
    engineEl.textContent = "滑块接管：已关闭（依赖未满足）";
    return;
  }
  chrome.runtime.sendMessage({ type: "rule-status" }, (response) => {
    if (chrome.runtime.lastError || !response || !response.rule) {
      engineEl.textContent = "滑块接管：重定向未注册（将使用页面注入备用）";
      return;
    }
    const redirect = response.rule.action && response.rule.action.redirect;
    const path = (redirect && redirect.extensionPath) || "";
    engineEl.textContent =
      "滑块接管：" + (path.indexOf("silent") >= 0 ? "静默版" : "可见版") + "（重定向已注册）";
  });
}

function refreshStatus() {
  queryActiveTab((tab) => {
    if (!tab || !tab.id) {
      setStatus("请打开统一认证登录页", "warn");
      return;
    }
    chrome.tabs.sendMessage(tab.id, { type: "status" }, (response) => {
      if (chrome.runtime.lastError || !response) {
        setStatus("请打开统一认证登录页", "warn");
        return;
      }
      if (!response.loginPage) {
        setStatus("当前不是登录页", "warn");
        return;
      }
      if (response.captcha) {
        const enabled = rememberInput.checked && autoFillInput.checked && solverInput.checked;
        setStatus(
          enabled ? "检测到滑块，正在自动处理" : "检测到滑块（自动滑块已关闭）",
          enabled ? "ok" : "warn"
        );
        return;
      }
      setStatus(response.hasFields ? "登录页已就绪" : "等待登录框加载…", response.hasFields ? "ok" : "warn");
    });
  });
}

$("togglePwd").addEventListener("click", () => {
  const show = passwordInput.type === "password";
  passwordInput.type = show ? "text" : "password";
  $("togglePwd").textContent = show ? "隐藏" : "显示";
  $("togglePwd").title = show ? "隐藏密码" : "显示密码";
});

rememberInput.addEventListener("change", async () => {
  syncPasswordState();
  syncDependencyState();
  try {
    if (!rememberInput.checked) {
      await chrome.storage.local.set({
        rememberPassword: false,
        password: "",
        autoFill: false,
        autoLogin: false,
        solver: false,
        silent: false
      });
      setFeedback("已关闭保存密码，后续自动操作已停用");
    } else {
      await persistBehavior();
      setFeedback("保存密码已开启，请重新输入密码并保存");
    }
    setTimeout(refreshRule, 350);
  } catch (error) {
    setFeedback("保存失败：" + String(error), true);
  }
});

[autoFillInput, solverInput, silentInput].forEach((input) => {
  input.addEventListener("change", async () => {
    syncDependencyState();
    try {
      await persistBehavior();
      const needsReload = input === solverInput || input === silentInput;
      setFeedback(needsReload ? "设置已保存，刷新登录页后生效" : "设置已自动保存");
      setTimeout(refreshRule, 350);
    } catch (error) {
      setFeedback("保存失败：" + String(error), true);
    }
  });
});

$("save").addEventListener("click", async () => {
  try {
    await saveSettings(true);
    refreshStatus();
    setTimeout(refreshRule, 350);
  } catch (error) {
    setFeedback("保存失败：" + String(error), true);
  }
});

$("fillNow").addEventListener("click", async () => {
  try {
    if (!usernameInput.value.trim()) {
      setFeedback("请先填写学号/工号", true);
      usernameInput.focus();
      return;
    }
    await saveSettings(false);
    setTimeout(refreshRule, 350);
    queryActiveTab((tab) => {
      if (!tab || !tab.id) {
        setFeedback("请先打开统一认证登录页", true);
        return;
      }
      chrome.tabs.sendMessage(tab.id, { type: "fill-now" }, (response) => {
        if (chrome.runtime.lastError) {
          setFeedback("当前页面不是登录页，请先打开登录页", true);
          return;
        }
        if (!response || !response.ok) {
          if (response && response.reason === "captcha-already-open") {
            setFeedback("滑块已在自动处理，请稍候");
          } else if (response && response.reason === "need-password") {
            setFeedback("自动填充已关闭或缺少密码，请手动输入账号密码", true);
          } else if (response && response.reason === "no-visible-fields") {
            setFeedback("请切换到账号密码登录标签", true);
          } else if (response && response.reason === "username-mismatch") {
            setFeedback("页面用户名与已保存账号不一致，请检查", true);
          } else if (response && response.reason === "disabled") {
            setFeedback("自动填充/登录已关闭，请先在设置中开启", true);
          } else {
            setFeedback("未执行：" + ((response && response.reason) || "页面未就绪"), true);
          }
          return;
        }
        if (response.clicked) {
          setFeedback("正在自动登录…");
        } else if (response.reason === "captcha-already-open") {
          setFeedback("滑块已在自动处理，请稍候");
        } else {
          setFeedback("已完成填充，请手动点击登录");
        }
        refreshStatus();
      });
    });
  } catch (error) {
    setFeedback("执行失败：" + String(error), true);
  }
});

$("clear").addEventListener("click", async () => {
  if (!confirm("确定清除已保存的账号和密码？")) return;
  await chrome.storage.local.set({
    username: "",
    password: "",
    rememberPassword: true,
    autoFill: true,
    autoLogin: true,
    solver: true,
    silent: true
  });
  usernameInput.value = "";
  passwordInput.value = "";
  rememberInput.checked = true;
  autoFillInput.checked = true;
  solverInput.checked = true;
  silentInput.checked = true;
  syncPasswordState();
  syncDependencyState();
  setFeedback("已清除已保存信息");
  refreshStatus();
  setTimeout(refreshRule, 350);
});

$("openLogin").addEventListener("click", () => {
  chrome.tabs.create({ url: LOGIN_URL });
});

loadSettings()
  .then(() => {
    refreshStatus();
    refreshRule();
  })
  .catch((error) => setFeedback("读取设置失败：" + String(error), true));
