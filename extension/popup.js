const authSection = document.getElementById('authSection');
const accountSection = document.getElementById('accountSection');
const emailInput = document.getElementById('email');
const passwordInput = document.getElementById('password');
const loginBtn = document.getElementById('loginBtn');
const loginError = document.getElementById('loginError');
const accountEmail = document.getElementById('accountEmail');
const logoutBtn = document.getElementById('logoutBtn');
const toggleBtn = document.getElementById('toggleBtn');
const optionsLink = document.getElementById('optionsLink');

function sendMsg(type, payload = {}) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage({ type, ...payload }, (res) => {
      if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
      if (!res?.ok) return reject(new Error(res?.error || 'Request failed'));
      resolve(res.data);
    });
  });
}

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

async function refresh() {
  const state = await sendMsg('GET_AUTH_STATE').catch(() => ({ loggedIn: false }));
  if (state.loggedIn) {
    authSection.hidden = true;
    accountSection.hidden = false;
    accountEmail.textContent = state.email;
    await refreshToggleState();
  } else {
    authSection.hidden = false;
    accountSection.hidden = true;
  }
}

async function refreshToggleState() {
  const tab = await getActiveTab();
  if (!tab?.id || !/^https?:/.test(tab.url || '')) {
    toggleBtn.disabled = true;
    toggleBtn.textContent = 'Reading Mode unavailable on this page';
    return;
  }
  toggleBtn.disabled = false;
  chrome.tabs.sendMessage(tab.id, { type: 'GET_READING_MODE_STATE' }, (res) => {
    const isActive = !chrome.runtime.lastError && res?.active;
    toggleBtn.textContent = isActive ? 'Stop Reading Mode' : 'Start Reading Mode';
  });
}

loginBtn.addEventListener('click', async () => {
  loginError.textContent = '';
  loginBtn.disabled = true;
  try {
    await sendMsg('LOGIN', { email: emailInput.value.trim(), password: passwordInput.value });
    passwordInput.value = '';
    await refresh();
  } catch (err) {
    loginError.textContent = err.message;
  } finally {
    loginBtn.disabled = false;
  }
});

logoutBtn.addEventListener('click', async () => {
  await sendMsg('LOGOUT');
  await refresh();
});

toggleBtn.addEventListener('click', async () => {
  const tab = await getActiveTab();
  if (!tab?.id) return;
  toggleBtn.disabled = true;
  chrome.tabs.sendMessage(tab.id, { type: 'TOGGLE_READING_MODE' }, (res) => {
    toggleBtn.disabled = false;
    if (chrome.runtime.lastError) {
      toggleBtn.textContent = 'Reload the page and try again';
      return;
    }
    toggleBtn.textContent = res?.active ? 'Stop Reading Mode' : 'Start Reading Mode';
  });
});

optionsLink.addEventListener('click', (e) => {
  e.preventDefault();
  chrome.runtime.openOptionsPage();
});

refresh();
