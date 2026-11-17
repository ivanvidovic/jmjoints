// Small interface helpers shared by the sections.

// A button that throws away a game in progress asks first: the first tap turns it into "Sure? Tap again" for a few
// seconds, the second does it. With nothing to lose (no game, or a finished one) it acts straight away.
export function confirmTap(btn, needsAsking, act) {
  const label = btn.textContent;
  let armed = 0;
  const disarm = () => { clearTimeout(armed); armed = 0; btn.textContent = label; btn.classList.remove('armed'); };
  btn.addEventListener('click', () => {
    if (armed || !needsAsking()) { disarm(); act(); return; }
    btn.textContent = 'Sure? Tap again'; btn.classList.add('armed');
    armed = setTimeout(disarm, 3200);
  });
  btn.addEventListener('blur', () => { if (armed) disarm(); });
}

// "How to" hints are shown until the visitor first does the thing, then they fade and stay away on later visits.
const learnedKey = (k) => `jm-learned-${k}`;
const isLearned = (k) => { try { return localStorage.getItem(learnedKey(k)) === '1'; } catch (e) { return false; } };
const hints = new Map();
export function hint(el, key) {
  if (!el) return;
  hints.set(key, el);
  if (isLearned(key)) el.classList.add('learned');
}
export function learn(key) {
  if (isLearned(key)) return;
  try { localStorage.setItem(learnedKey(key), '1'); } catch (e) {}
  const el = hints.get(key); if (el) el.classList.add('learned');
}

// Saved game state between visits (unfinished games pick up where they were left).
export function saveGame(key, data) { try { if (data) localStorage.setItem(`jm-game-${key}`, JSON.stringify(data)); else localStorage.removeItem(`jm-game-${key}`); } catch (e) {} }
export function loadGame(key) { try { return JSON.parse(localStorage.getItem(`jm-game-${key}`) || 'null'); } catch (e) { return null; } }
