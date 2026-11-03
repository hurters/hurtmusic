<div align="center">

# ⚡ HurtMusic Desktop

**Next-Gen Hi-Fi Desktop Music Player & Underground Unreleased Sound Engine**

[![Release](https://img.shields.io/badge/Release-v1.0.0-6366f1?style=for-the-badge&logo=github&logoColor=white)](https://github.com/hurters/hurtmusic/releases)
[![Platform](https://img.shields.io/badge/Platform-Windows%20x64-0078d7?style=for-the-badge&logo=windows&logoColor=white)](https://github.com/hurters/hurtmusic/releases)
[![Engine](https://img.shields.io/badge/Engine-Electron%20%2B%20Chromium-47cf73?style=for-the-badge&logo=electron&logoColor=white)](https://electronjs.org)
[![Discord](https://img.shields.io/badge/Discord-Rich%20Presence-5865f2?style=for-the-badge&logo=discord&logoColor=white)](https://discord.com)
[![License](https://img.shields.io/badge/License-MIT-f59e0b?style=for-the-badge)](LICENSE)

<br/>

> **HurtMusic** — это современный независимый музыкальный плеер нового поколения, созданный для тех, кому тесно в стандартных рамках стримингов. Плеер объединяет доступ к эксклюзивным сливам и андерграунду, плавающий геймерский оверлей поверх игр, моментальные обновления по воздуху (OTA) и невероятную производительность.

<br/>

[ Скачать Portable (.zip) ](https://github.com/hurters/hurtmusic/releases/latest) • [ Киллер-фичи ](#-киллер-фичи) • [ Геймерский HUD ](#-мини-плеер-поверх-игр-gamer-hud) • [ Горячие клавиши ](#-горячие-клавиши) • [ Сборка ](#-разработка-и-сборка)

---

</div>

<br/>

## 💎 Почему HurtMusic?

В 2026 году официальные стриминги (Spotify, Apple Music, Яндекс Музыка) удаляют треки из-за авторских прав, блокируют каталоги и заставляют включать VPN. **HurtMusic** решает главные боли слушателей:

```
┌────────────────────────────────────────────────────────────────────────┐
│  🔥 Сливы, ремиксы и сниппеты SoundCloud без VPN и блокировок         │
│  💾 Скачивание треков напрямую в папку на ПК в 1 клик навсегда         │
│  🎮 Плавающий Always-on-Top оверлей для CS2, Dota 2, GTA RP & Valorant │
│  ⚡ Обновления по воздуху (Hot-OTA) за 5 секунд без переустановки     │
│  📊 Потребляет всего ~80–110 МБ RAM — в 3 раза легче Spotify & Discord │
└────────────────────────────────────────────────────────────────────────┘
```

<br/>

## 🚀 Киллер-фичи

### 🥇 1. «Слушай то, чего НЕТ нигде официально» (Unreleased & Underground Cache)
* **Потоковый стриминг SoundCloud в Hi-Fi качестве:** сниппеты, unreleased сливы Playboi Carti, Toxi$, рэп-ремиксы, slowed+reverb, фонк и mashup'ы доступны мгновенно без ограничений и VPN.
* **1-клик сохранение навсегда:** кнопка скачивания сохраняет чистый трек напрямую в обычную папку на компьютере (`Музыка/HurtMusic` или любую выбранную папку) вместе с тегами исполнителя и HD-обложкой.
* **Независимость от интернета:** даже если трек удалят с SoundCloud или заблокируют — он навсегда остаётся у вас локально.

### 🥈 2. «Мини-плеер поверх игр» (Always-on-Top Gamer HUD)
* **Управление музыкой без сворачивания игры:** компактный плавающий HUD (340×84 px) закрепляется поверх CS2, Dota 2, Valorant или GTA RP.
* **Аппаратное ускорение:** крутящийся винил, бегущая строка названия, лайки и перемотка отрисовываются с ультра-низкой задержкой и не просаживают FPS в катках.
* **Быстрый хоткей:** активируется в любую секунду сочетанием клавиш `Ctrl + Shift + M`.

### ⚡ 3. «Обновления по воздуху» (Hot-OTA Engine)
* **Забудьте про установщики и повторные setup.exe:** плеер сам проверяет наличие свежих релизов на GitHub.
* При появлении апдейта всплывает аккуратное уведомление. Один клик — и плеер в фоне скачивает обновление (~37 МБ) и перезапускается за секунду.

### 🎛️ 4. Студийный визуализатор звука и Кибер-эстетика
* 64-полосный спектральный визуализатор гармоник звука в реальном времени на базе Web Audio API.
* Два режима оформления: глубокий неоновый **Hurt Dark** и аутентичный **Винил**.
* Динамический адаптер разрешения экрана — идеальная картинка даже при растянутом разрешении 4:3 (`1440×1080` в CS2).

### 🎮 5. Discord Rich Presence
* Трансляция текущего трека, автора, тайминга и анимированной обложки в ваш профиль Discord в реальном времени.

<br/>

---

## 🎮 Горячие клавиши

| Сочетание клавиш | Действие |
| :--- | :--- |
| <kbd>Пробел</kbd> | Воспроизведение / Пауза |
| <kbd>Ctrl</kbd> + <kbd>→</kbd> / <kbd>MediaNextTrack</kbd> | Следующий трек |
| <kbd>Ctrl</kbd> + <kbd>←</kbd> / <kbd>MediaPrevTrack</kbd> | Предыдущий трек |
| <kbd>Ctrl</kbd> + <kbd>Shift</kbd> + <kbd>M</kbd> | **Включить / Выключить мини-плеер поверх игр (HUD)** |
| <kbd>F</kbd> | Добавить / Убрать из «Избранного» |
| <kbd>↑</kbd> / <kbd>↓</kbd> | Регулировка громкости |
| <kbd>M</kbd> | Выключить звук (Mute) |

<br/>

---

## 📥 Быстрый старт (Portable версия)

Плеер распространяется в полностью портативном виде — **не требует установки** и готов к работе за 5 секунд:

1. Перейдите во вкладку **[Releases](https://github.com/hurters/hurtmusic/releases/latest)**.
2. Скачайте архив `HurtMusic-v1.0.0-win-x64-portable.zip`.
3. Распакуйте архив в любое удобное место (на рабочий стол, диск D или флешку).
4. Запустите **`hurtmusic.exe`** и наслаждайтесь любимой музыкой!

> [!TIP]
> Приложение не засоряет реестр Windows и хранит ваши настройки локально в профиле пользователя.

<br/>

---

## 🛠️ Разработка и сборка

### Стек технологий:
* **Runtime:** [Electron 32](https://www.electronjs.org/) + Chromium
* **Audio Engine:** HTML5 Audio, Web Audio API, HLS.js (Adaptive Bitrate Streaming)
* **Desktop Integration:** Global Media Shortcuts, Windows System Tray, Discord-RPC, Child-Process Detached OTA
* **Styling:** CSS3 Hardware Accelerated Glassmorphism, Zero Heavy CSS Frameworks

### Запуск из исходного кода:
```bash
# Клонирование репозитория
git clone https://github.com/hurters/hurtmusic.git
cd hurtmusic

# Установка зависимостей
npm install

# Запуск тестов
npm test

# Запуск приложения
npm start
```

### Сборка ASAR пакета:
```bash
node repack.js
```

<br/>

---

## ⚖️ Лицензия

Проект распространяется под открытой лицензией [MIT](LICENSE).

<div align="center">
  <sub>Сделано с душой для ценителей андерграунда и настоящего звука.</sub>
</div>
