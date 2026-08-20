import { api } from '../api.js';

const PROVIDER_LABELS = { anthropic: 'Anthropic (Claude)', openai: 'OpenAI (GPT)' };

export async function renderSettings(host) {
  host.innerHTML = '<div class="loading">Loading settings…</div>';

  let current;
  try {
    current = await api.getLlmSettings();
  } catch (err) {
    host.innerHTML = `<div class="error">Failed to load settings.<br><small>${err.message}</small></div>`;
    return;
  }

  function render() {
    host.innerHTML = `
      <div class="formPage">
        <h1>Settings</h1>
        <p class="hint">
          Add your own AI API key. This key is personal to your account — it's stored encrypted,
          only ever used for your own requests, and nobody else can use it.
        </p>

        <div class="authCard" style="max-width:420px;margin:18px 0 0">
          ${
            current.configured
              ? `<p><strong>Current provider:</strong> ${PROVIDER_LABELS[current.provider] || current.provider}</p>
                 <p class="hint" style="padding:0 0 14px">The key itself is never shown again once saved.</p>
                 <button id="clearBtn" type="button">Remove API Key</button>`
              : ''
          }
          <form id="llmForm" style="margin-top:${current.configured ? '18px' : '0'}">
            <label>Provider
              <select id="provider">
                <option value="anthropic">Anthropic (Claude)</option>
                <option value="openai">OpenAI (GPT)</option>
              </select>
            </label>
            <label>API Key
              <input type="password" id="apiKey" autocomplete="off" placeholder="sk-…" required>
            </label>
            <button type="submit">${current.configured ? 'Replace Key' : 'Save Key'}</button>
          </form>
          <div id="settingsStatus" class="importStatus"></div>
        </div>
      </div>
    `;

    const form = host.querySelector('#llmForm');
    const status = host.querySelector('#settingsStatus');
    const clearBtn = host.querySelector('#clearBtn');

    form.onsubmit = async (e) => {
      e.preventDefault();
      const provider = host.querySelector('#provider').value;
      const apiKey = host.querySelector('#apiKey').value.trim();
      status.textContent = 'Saving…';
      status.className = 'importStatus';
      try {
        current = await api.saveLlmSettings(provider, apiKey);
        render();
        const newStatus = host.querySelector('#settingsStatus');
        newStatus.textContent = 'Saved.';
        newStatus.className = 'importStatus success';
      } catch (err) {
        status.textContent = `Error: ${err.message}`;
        status.className = 'importStatus error';
      }
    };

    if (clearBtn) {
      clearBtn.onclick = async () => {
        clearBtn.disabled = true;
        try {
          current = await api.clearLlmSettings();
          render();
        } catch (err) {
          status.textContent = `Error: ${err.message}`;
          status.className = 'importStatus error';
          clearBtn.disabled = false;
        }
      };
    }
  }

  render();
}
