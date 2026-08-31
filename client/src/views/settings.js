import { api } from '../api.js';

const PROVIDER_LABELS = { anthropic: 'Anthropic (Claude)', openai: 'OpenAI (GPT)', deepseek: 'DeepSeek' };

export async function renderSettings(host) {
  host.innerHTML = '<div class="loading">Loading settings…</div>';

  let translation, vision, asr, voiceInfo, voiceCurrent;
  try {
    [translation, vision, asr, voiceInfo, voiceCurrent] = await Promise.all([
      api.getLlmSettings(),
      api.getVisionSettings(),
      api.getAsrSettings(),
      api.getVoices(),
      api.getVoiceSettings(),
    ]);
  } catch (err) {
    host.innerHTML = `<div class="error">Failed to load settings.<br><small>${err.message}</small></div>`;
    return;
  }

  function render() {
    host.innerHTML = `
      <div class="formPage">
        <h1>Translation API Key</h1>
        <p class="hint">
          Used to translate and format text — the whole-book PDF import pipeline, mainly. Any text
          model works, including cheaper ones like DeepSeek, since this never needs to read an image.
          Personal to your account, stored encrypted, and never used for anyone else's requests.
        </p>

        <div class="authCard" style="max-width:420px;margin:18px 0 0">
          ${
            translation.configured
              ? `<p><strong>Current provider:</strong> ${PROVIDER_LABELS[translation.provider] || translation.provider}</p>
                 <p class="hint" style="padding:0 0 14px">The key itself is never shown again once saved.</p>
                 <button id="clearLlmBtn" type="button">Remove API Key</button>`
              : ''
          }
          <form id="llmForm" style="margin-top:${translation.configured ? '18px' : '0'}">
            <label>Provider
              <select id="provider">
                <option value="anthropic">Anthropic (Claude)</option>
                <option value="openai">OpenAI (GPT)</option>
                <option value="deepseek">DeepSeek</option>
              </select>
            </label>
            <label>API Key
              <input type="password" id="apiKey" autocomplete="off" placeholder="sk-…" required>
            </label>
            <button type="submit">${translation.configured ? 'Replace Key' : 'Save Key'}</button>
          </form>
          <div id="llmStatus" class="importStatus"></div>
        </div>

        <h1 style="margin-top:32px">Vision / OCR API Key</h1>
        <p class="hint">
          Used to read images directly — the page-photo batch upload in Add Pages, and OCR for PDF
          pages that turn out to be scanned images rather than real text. Needs a vision-capable
          model, so only Anthropic or OpenAI (DeepSeek has no vision API). Optional: without this,
          scanned PDF pages are just skipped and listed instead of guessed at.
        </p>

        <div class="authCard" style="max-width:420px;margin:18px 0 0">
          ${
            vision.configured
              ? `<p><strong>Current provider:</strong> ${PROVIDER_LABELS[vision.provider] || vision.provider}</p>
                 <p class="hint" style="padding:0 0 14px">The key itself is never shown again once saved.</p>
                 <button id="clearVisionBtn" type="button">Remove API Key</button>`
              : ''
          }
          <form id="visionForm" style="margin-top:${vision.configured ? '18px' : '0'}">
            <label>Provider
              <select id="visionProvider">
                <option value="anthropic">Anthropic (Claude)</option>
                <option value="openai">OpenAI (GPT)</option>
              </select>
            </label>
            <label>API Key
              <input type="password" id="visionApiKey" autocomplete="off" placeholder="sk-…" required>
            </label>
            <button type="submit">${vision.configured ? 'Replace Key' : 'Save Key'}</button>
          </form>
          <div id="visionStatus" class="importStatus"></div>
        </div>

        <h1 style="margin-top:32px">Speech Input (Z.AI) API Key</h1>
        <p class="hint">
          Used by Lesson 1's "speak your answer" microphone button — Z.AI's GLM-ASR model
          transcribes what you say into text, which fills the answer field the same as typing.
          Optional: without this, the mic button is hidden and you just type your answers.
        </p>

        <div class="authCard" style="max-width:420px;margin:18px 0 0">
          ${
            asr.configured
              ? `<p><strong>Configured.</strong></p>
                 <p class="hint" style="padding:0 0 14px">The key itself is never shown again once saved.</p>
                 <button id="clearAsrBtn" type="button">Remove API Key</button>`
              : ''
          }
          <form id="asrForm" style="margin-top:${asr.configured ? '18px' : '0'}">
            <label>Z.AI API Key
              <input type="password" id="asrApiKey" autocomplete="off" placeholder="sk-…" required>
            </label>
            <button type="submit">${asr.configured ? 'Replace Key' : 'Save Key'}</button>
          </form>
          <div id="asrStatus" class="importStatus"></div>
        </div>

        <h1 style="margin-top:32px">Voice</h1>
        <p class="hint">
          Controls the "Read Aloud" voice in the reader — runs locally on the server (Piper), no API
          key needed. The first time you pick a new voice it takes a moment to download; after that
          it's instant.
        </p>
        <div class="authCard" style="max-width:420px;margin:18px 0 0">
          <form id="voiceForm">
            <label>Voice
              <select id="voiceId">
                ${voiceInfo.voices
                  .map((v) => `<option value="${v.id}" ${v.id === voiceCurrent.voiceId ? 'selected' : ''}>${v.label}</option>`)
                  .join('')}
              </select>
            </label>
            <label>Speed: <span id="rateLabel">${Number(voiceCurrent.speechRate).toFixed(2)}×</span>
              <input type="range" id="speechRate" min="${voiceInfo.minRate}" max="${voiceInfo.maxRate}" step="0.05" value="${voiceCurrent.speechRate}">
            </label>
            <button type="submit">Save Voice</button>
          </form>
          <div id="voiceStatus" class="importStatus"></div>
        </div>
      </div>
    `;

    const llmForm = host.querySelector('#llmForm');
    const llmStatus = host.querySelector('#llmStatus');
    const clearLlmBtn = host.querySelector('#clearLlmBtn');
    const providerSelect = host.querySelector('#provider');

    if (translation.provider) providerSelect.value = translation.provider;

    llmForm.onsubmit = async (e) => {
      e.preventDefault();
      const provider = providerSelect.value;
      const apiKey = host.querySelector('#apiKey').value.trim();
      llmStatus.textContent = 'Saving…';
      llmStatus.className = 'importStatus';
      try {
        translation = await api.saveLlmSettings(provider, apiKey);
        render();
        host.querySelector('#llmStatus').textContent = 'Saved.';
        host.querySelector('#llmStatus').className = 'importStatus success';
      } catch (err) {
        llmStatus.textContent = `Error: ${err.message}`;
        llmStatus.className = 'importStatus error';
      }
    };

    if (clearLlmBtn) {
      clearLlmBtn.onclick = async () => {
        clearLlmBtn.disabled = true;
        try {
          translation = await api.clearLlmSettings();
          render();
        } catch (err) {
          llmStatus.textContent = `Error: ${err.message}`;
          llmStatus.className = 'importStatus error';
          clearLlmBtn.disabled = false;
        }
      };
    }

    const visionForm = host.querySelector('#visionForm');
    const visionStatus = host.querySelector('#visionStatus');
    const clearVisionBtn = host.querySelector('#clearVisionBtn');
    const visionProviderSelect = host.querySelector('#visionProvider');

    if (vision.provider) visionProviderSelect.value = vision.provider;

    visionForm.onsubmit = async (e) => {
      e.preventDefault();
      const provider = visionProviderSelect.value;
      const apiKey = host.querySelector('#visionApiKey').value.trim();
      visionStatus.textContent = 'Saving…';
      visionStatus.className = 'importStatus';
      try {
        vision = await api.saveVisionSettings(provider, apiKey);
        render();
        host.querySelector('#visionStatus').textContent = 'Saved.';
        host.querySelector('#visionStatus').className = 'importStatus success';
      } catch (err) {
        visionStatus.textContent = `Error: ${err.message}`;
        visionStatus.className = 'importStatus error';
      }
    };

    if (clearVisionBtn) {
      clearVisionBtn.onclick = async () => {
        clearVisionBtn.disabled = true;
        try {
          vision = await api.clearVisionSettings();
          render();
        } catch (err) {
          visionStatus.textContent = `Error: ${err.message}`;
          visionStatus.className = 'importStatus error';
          clearVisionBtn.disabled = false;
        }
      };
    }

    const asrForm = host.querySelector('#asrForm');
    const asrStatus = host.querySelector('#asrStatus');
    const clearAsrBtn = host.querySelector('#clearAsrBtn');

    asrForm.onsubmit = async (e) => {
      e.preventDefault();
      const apiKey = host.querySelector('#asrApiKey').value.trim();
      asrStatus.textContent = 'Saving…';
      asrStatus.className = 'importStatus';
      try {
        asr = await api.saveAsrSettings('zai', apiKey);
        render();
        host.querySelector('#asrStatus').textContent = 'Saved.';
        host.querySelector('#asrStatus').className = 'importStatus success';
      } catch (err) {
        asrStatus.textContent = `Error: ${err.message}`;
        asrStatus.className = 'importStatus error';
      }
    };

    if (clearAsrBtn) {
      clearAsrBtn.onclick = async () => {
        clearAsrBtn.disabled = true;
        try {
          asr = await api.clearAsrSettings();
          render();
        } catch (err) {
          asrStatus.textContent = `Error: ${err.message}`;
          asrStatus.className = 'importStatus error';
          clearAsrBtn.disabled = false;
        }
      };
    }

    const voiceForm = host.querySelector('#voiceForm');
    const voiceStatus = host.querySelector('#voiceStatus');
    const rateInput = host.querySelector('#speechRate');
    const rateLabel = host.querySelector('#rateLabel');

    rateInput.oninput = () => {
      rateLabel.textContent = `${Number(rateInput.value).toFixed(2)}×`;
    };

    voiceForm.onsubmit = async (e) => {
      e.preventDefault();
      const voiceId = host.querySelector('#voiceId').value;
      const speechRate = Number(rateInput.value);
      voiceStatus.textContent = 'Saving…';
      voiceStatus.className = 'importStatus';
      try {
        voiceCurrent = await api.saveVoiceSettings(voiceId, speechRate);
        voiceStatus.textContent = 'Saved.';
        voiceStatus.className = 'importStatus success';
      } catch (err) {
        voiceStatus.textContent = `Error: ${err.message}`;
        voiceStatus.className = 'importStatus error';
      }
    };
  }

  render();
}
