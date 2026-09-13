import { api } from '../api.js';
import { invalidateDictionaryCache } from '../state.js';

const EXAMPLE = `Ich = I
gehe = go
zur Arbeit = to work
ging → gehen = went
der Tisch, die Tische = table`;

export function renderAddWords(host) {
  host.innerHTML = `
    <div class="formPage">
      <a href="#/">← Library</a>
      <h1>Add Words</h1>
      <p class="hint">
        Paste vocabulary lines in the format <code>word = meaning</code> — the same lines your
        translation notes already use. This adds them to the shared dictionary, so clicking those
        words anywhere in any book shows the meaning. Use <code>word → infinitive = meaning</code>
        for conjugated verbs (needed for separable-verb detection), and lines like
        <code>der Tisch, die Tische = meaning</code> for nouns (the article is stripped automatically).
        Words already in the dictionary get their meaning updated, not duplicated.
      </p>
      <details class="exampleBox">
        <summary>Example format</summary>
        <pre>${EXAMPLE}</pre>
      </details>
      <textarea id="wordsText" dir="ltr" placeholder="${EXAMPLE.replace(/"/g, '&quot;')}"></textarea>
      <div class="formActions">
        <button id="importBtn">Add Words</button>
        <a href="#/">Cancel</a>
      </div>
      <div id="importStatus" class="importStatus"></div>
    </div>
  `;

  const textarea = host.querySelector('#wordsText');
  const status = host.querySelector('#importStatus');
  const btn = host.querySelector('#importBtn');

  btn.onclick = async () => {
    const text = textarea.value.trim();
    if (!text) {
      status.textContent = 'Enter some vocabulary lines first.';
      status.className = 'importStatus error';
      return;
    }
    btn.disabled = true;
    status.textContent = 'Adding…';
    status.className = 'importStatus';
    try {
      const result = await api.importDictionary(text);
      status.textContent = `Added/updated ${result.imported} word${result.imported === 1 ? '' : 's'} in the dictionary.`;
      status.className = 'importStatus success';
      textarea.value = '';
      invalidateDictionaryCache();
    } catch (err) {
      status.textContent = `Error: ${err.message}`;
      status.className = 'importStatus error';
    } finally {
      btn.disabled = false;
    }
  };
}
