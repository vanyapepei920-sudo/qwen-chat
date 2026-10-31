// ---- Переключение тёмной/светлой темы ----
const root = document.documentElement;
document.getElementById('themeToggle').addEventListener('click', () => {
  const next = root.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
  root.setAttribute('data-theme', next);
  localStorage.setItem('theme', next);
});

// ---- Выпадающее меню пользователя ----
const avatarBtn = document.getElementById('avatarBtn');
if (avatarBtn) {
  const dd = document.getElementById('userDropdown');
  avatarBtn.addEventListener('click', (e) => { e.stopPropagation(); dd.classList.toggle('open'); });
  document.addEventListener('click', () => dd.classList.remove('open'));
}
