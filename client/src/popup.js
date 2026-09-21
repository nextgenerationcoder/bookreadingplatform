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

export function showPopupFor(anchorEl, word, gloss) {
  const popup = ensurePopup();
  popup.querySelector('#popupWord').textContent = word;
  popup.querySelector('#popupGloss').textContent = gloss;
  popup.classList.add('show');

  const r = anchorEl.getBoundingClientRect();
  const pr = popup.getBoundingClientRect();
  let left = Math.min(window.innerWidth - pr.width - 12, Math.max(12, r.left + r.width / 2 - pr.width / 2));
  let top = r.bottom + 10;
  if (top + pr.height > window.innerHeight - 10) top = Math.max(10, r.top - pr.height - 10);
  popup.style.left = `${left}px`;
  popup.style.top = `${top}px`;
}

document.addEventListener('click', (e) => {
  if (!e.target.closest('.word') && !e.target.closest('#popup')) hidePopup();
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') hidePopup();
});
