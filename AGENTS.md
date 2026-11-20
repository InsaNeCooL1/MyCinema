# Project instructions

- Працюємо локально: **нічого не пушити в git без явного доручення**.
- Після змін у `src/*.js` або `styles/*.css` перезбирати `bundle.js` і `styles.css`:
  `npm run build`.
- Перевірка перед завершенням: `npm test` (Vitest).
- `bundle.js` і `styles.css` — згенеровані файли, редагувати треба джерела в
  `src/` і `styles/`.
- Оточення: Crostini на Chromebook, Debian arm64. Node.js 22 встановлено
  з офіційного tarball (apt дає застарілу версію для Vitest 5).
- Локальний перегляд: `http://100.115.92.26:8080/`
  (systemd-юніт `mycinema-8080.service`, автозапуск увімкнено).
- З браузера Chromebook'а використовувати IP контейнера, а не `localhost`.
- **Ніколи не згадувати в повідомленнях комітів** TorrServer, онлайн-плеєри,
  балансери, торренти, стрімінг і подібні деталі. Використовувати нейтральні
  описи на кшталт `FIX: misc local improvements`.
