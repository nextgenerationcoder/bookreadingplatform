// Shared right-click context menu for words/phrases in the reader: Mark
// known / Mark unknown / Change translation. Kept separate from reader.js
// since both the menu widget and the "pick the matching Persian text"
// flow it triggers are self-contained UI concerns with no reader-specific
// state of their own - reader.js just calls showWordMenu() with the
// actions it wants offered, and showTranslationPicker() when "Change
// translation" is chosen.

let menuEl = null;
let pickerEl = null;
let pickingFaEl = null;
let linkBannerEl = null;
let linkingFirstEl = null;
let linkingSentenceEl = null;
let linkingClickHandler = null;

function ensureMenu() {
  if (menuEl) return menuEl;
  menuEl = document.createElement('div');
  menuEl.className = 'wordMenu';
  document.body.appendChild(menuEl);
  return menuEl;
}

export function hideWordMenu() {
  if (menuEl) menuEl.classList.remove('show');
}

document.addEventListener('click', (e) => {
  if (!e.target.closest('.wordMenu')) hideWordMenu();
});
document.addEventListener('contextmenu', (e) => {
  if (!e.target.closest('.word, .wordMenu')) hideWordMenu();
});
document.addEventListener('scroll', hideWordMenu, true);
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    hideWordMenu();
    closeTranslationPicker();
    closeVerbLinkPicker();
  }
});

// items: [{label, onClick}]
export function showWordMenu(x, y, items) {
  closeVerbLinkPicker();
  const menu = ensureMenu();
  menu.innerHTML = '';
  for (const item of items) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = item.label;
    btn.onclick = () => {
      hideWordMenu();
      item.onClick();
    };
    menu.appendChild(btn);
  }
  menu.style.left = '0px';
  menu.style.top = '0px';
  menu.classList.add('show');
  // Measure after it's in the DOM and visible, then clamp to the viewport.
  const rect = menu.getBoundingClientRect();
  const left = Math.max(8, Math.min(x, window.innerWidth - rect.width - 8));
  const top = Math.max(8, Math.min(y, window.innerHeight - rect.height - 8));
  menu.style.left = `${left}px`;
  menu.style.top = `${top}px`;
}

// "Change translation" flow: the learner drag-selects the matching Persian
// text in the sentence's own translation line (faEl) rather than typing
// anything, then presses Save. onSave(selectedText) does the actual API
// call and should throw/reject on failure.
export function showTranslationPicker(faEl, label, onSave) {
  closeTranslationPicker();
  closeVerbLinkPicker();
  pickingFaEl = faEl;
  faEl.classList.add('pickingTranslation');

  pickerEl = document.createElement('div');
  pickerEl.className = 'translationPicker';
  pickerEl.innerHTML = `
    <span>Select the Persian text for "${escapeHtml(label)}", then Save</span>
    <button type="button" class="pickSaveBtn">Save</button>
    <button type="button" class="pickCancelBtn">Cancel</button>
    <span class="pickStatus"></span>
  `;
  faEl.insertAdjacentElement('afterend', pickerEl);

  const statusEl = pickerEl.querySelector('.pickStatus');
  pickerEl.querySelector('.pickCancelBtn').onclick = () => closeTranslationPicker();
  pickerEl.querySelector('.pickSaveBtn').onclick = async () => {
    const selection = window.getSelection();
    const text = selection ? selection.toString().trim() : '';
    if (!text) {
      statusEl.textContent = 'Select some Persian text first.';
      return;
    }
    statusEl.textContent = 'Saving…';
    try {
      await onSave(text);
      statusEl.textContent = 'Saved ✓';
      setTimeout(closeTranslationPicker, 700);
    } catch (err) {
      statusEl.textContent = `Error: ${err.message}`;
    }
  };
}

export function closeTranslationPicker() {
  pickingFaEl?.classList.remove('pickingTranslation');
  pickingFaEl = null;
  pickerEl?.remove();
  pickerEl = null;
}

// "Link separable verb" flow: a fallback for when separableVerbs.js's
// automatic clause-based detection misses a split verb (e.g. an irregular
// conjugation not in its tables, or a prefix straddling an unusual clause
// boundary). The learner clicks the first part's menu item, then clicks the
// matching second part elsewhere in the same sentence - onPick(secondEl)
// receives that span so reader.js can resolve/save the pair exactly like an
// auto-detected one.
export function closeVerbLinkPicker() {
  linkingFirstEl?.classList.remove('linkingSource');
  linkingSentenceEl?.classList.remove('linkingVerb');
  if (linkingSentenceEl && linkingClickHandler) {
    linkingSentenceEl.removeEventListener('click', linkingClickHandler, true);
  }
  linkBannerEl?.remove();
  linkBannerEl = null;
  linkingFirstEl = null;
  linkingSentenceEl = null;
  linkingClickHandler = null;
}

export function showVerbLinkPicker(sentenceEl, firstEl, label, onPick) {
  closeVerbLinkPicker();
  closeTranslationPicker();
  linkingFirstEl = firstEl;
  linkingSentenceEl = sentenceEl;
  firstEl.classList.add('linkingSource');
  sentenceEl.classList.add('linkingVerb');

  linkBannerEl = document.createElement('div');
  linkBannerEl.className = 'verbLinkBanner';
  linkBannerEl.innerHTML = `
    <span>Click the other part of "${escapeHtml(label)}" in this sentence</span>
    <button type="button" class="linkCancelBtn">Cancel</button>
  `;
  sentenceEl.querySelector('.de')?.insertAdjacentElement('afterend', linkBannerEl);

  linkBannerEl.querySelector('.linkCancelBtn').onclick = () => closeVerbLinkPicker();

  linkingClickHandler = (e) => {
    const span = e.target.closest('.word');
    if (!span || span === firstEl) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    closeVerbLinkPicker();
    onPick(span);
  };
  sentenceEl.addEventListener('click', linkingClickHandler, true);
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
