const DEFAULT_COLORS = { known: '#2f8f4e', learning: '#d98c2b', unset: '#9a9488' };

const knownInput = document.getElementById('known');
const learningInput = document.getElementById('learning');
const unsetInput = document.getElementById('unset');
const savedLabel = document.getElementById('saved');

async function load() {
  const { lexColors } = await chrome.storage.sync.get('lexColors');
  const colors = { ...DEFAULT_COLORS, ...(lexColors || {}) };
  knownInput.value = colors.known;
  learningInput.value = colors.learning;
  unsetInput.value = colors.unset;
}

document.getElementById('saveBtn').addEventListener('click', async () => {
  await chrome.storage.sync.set({
    lexColors: { known: knownInput.value, learning: learningInput.value, unset: unsetInput.value },
  });
  savedLabel.textContent = 'Saved ✓';
  setTimeout(() => (savedLabel.textContent = ''), 1500);
});

document.getElementById('resetBtn').addEventListener('click', async () => {
  await chrome.storage.sync.remove('lexColors');
  await load();
});

load();
