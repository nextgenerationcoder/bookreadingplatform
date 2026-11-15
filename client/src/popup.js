let popupEl = null;

function ensurePopup() {
  if (popupEl) return popupEl;
  popupEl = document.createElement('div');
  popupEl.id = 'popup';
  popupEl.className = 'popup';
  popupEl.setAttribute('role', 'dialog');
  popupEl.setAttribute('aria-live', 'polite');
  popupEl.innerHTML = '<div class="w" id="popupWord"></div><div class="g" id="popupGloss"></div>';
  document.body.appendChild(popupEl);
  return popupEl;
}

export function hidePopup() {
  if (popupEl) popupEl.classList.remove('show');
}

// frameRect: only needed when anchorEl lives inside a same-origin <iframe>
// (e.g. clickableGermanText.js applied to a worksheet) - getBoundingClientRect
// on an element inside a frame is relative to THAT frame's own viewport, not
// this (parent) document's, so the frame's own position (its
// getBoundingClientRect() as seen from here) must be added in. Omitted for
// every normal same-document caller (reader.js, and clickableGermanText.js
// outside an iframe), so this stays fully backward compatible.
export function showPopupFor(anchorEl, word, gloss, frameRect) {
  const popup = ensurePopup();
  popup.querySelector('#popupWord').textContent = word;
  popup.querySelector('#popupGloss').textContent = gloss;
  popup.classList.add('show');

  const r = anchorEl.getBoundingClientRect();
  const offsetLeft = frameRect?.left || 0;
  const offsetTop = frameRect?.top || 0;
  const pr = popup.getBoundingClientRect();
  let left = Math.min(window.innerWidth - pr.width - 12, Math.max(12, offsetLeft + r.left + r.width / 2 - pr.width / 2));
  let top = offsetTop + r.bottom + 10;
  if (top + pr.height > window.innerHeight - 10) top = Math.max(10, offsetTop + r.top - pr.height - 10);
  popup.style.left = `${left}px`;
  popup.style.top = `${top}px`;
}

document.addEventListener('click', (e) => {
  if (!e.target.closest('.word') && !e.target.closest('#popup')) hidePopup();
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') hidePopup();
});
