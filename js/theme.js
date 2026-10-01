// 主题：只有 dark / light 两态，写进 kurotto.prefs。
// 默认跟随系统偏好，但一旦玩家手动切过就以存档为准——刷新后的态必须与存档一致（save 腿断言这条）。
import { loadPrefs, savePrefs } from './store.js';

export const THEMES = ['dark', 'light'];

function systemTheme() {
  try { return matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark'; }
  catch (e) { return 'dark'; }
}

let current = null;

export function apply(theme) {
  current = THEMES.includes(theme) ? theme : systemTheme();
  document.documentElement.dataset.theme = current;
  document.body.dataset.theme = current;
  const btn = document.getElementById('btn-theme');
  if (btn) {
    const dark = current === 'dark';
    btn.textContent = dark ? '深色' : '浅色';
    btn.setAttribute('aria-pressed', dark ? 'true' : 'false');
  }
  return current;
}

export function get() { return current; }

export function toggle() {
  const next = current === 'dark' ? 'light' : 'dark';
  apply(next);
  savePrefs({ theme: next });
  return next;
}

export function init() {
  const saved = loadPrefs().theme;
  return apply(saved || systemTheme());
}
