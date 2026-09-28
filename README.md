# FORMA — AI-тренер через веб-камеру

Кейс ADMIT Hackathon «Motion: камера вместо джойстика».
FORMA — фитнес-тренер в браузере, которым управляют только телом, включая меню.
Он считает повторения, замечает ошибки техники и говорит, как их исправить.

> 🚧 Проект в разработке. Демо-ссылка и полное описание появятся до сдачи.

## Запуск

Нужен Node.js 20+.

```bash
npm install
npm run dev        # http://localhost:5173
```

Камера работает только на `localhost` или по HTTPS.
Режим без камеры, на мок-движке: `http://localhost:5173/?mock=1`.

| Команда          | Что делает                                  |
| ---------------- | ------------------------------------------- |
| `npm run dev`    | dev-сервер                                  |
| `npm run build`  | проверка типов и продакшен-сборка в `dist/` |
| `npm test`       | юнит-тесты (vitest)                         |
| `npm run lint`   | ESLint                                      |
| `npm run format` | Prettier                                    |

## Деплой (HTTPS)

Камера в браузере работает только по HTTPS, поэтому приложение выкладывается двумя путями:

- **GitHub Pages (работает сейчас):** форк [abdigaliarslan/admit-hack](https://github.com/abdigaliarslan/admit-hack)
  раз в 15 минут сам подтягивает `main` этого репозитория, прогоняет тесты и выкладывает сборку
  (`.github/workflows/pages.yml`). Приложение: https://abdigaliarslan.github.io/admit-hack/ ,
  стенд движка: https://abdigaliarslan.github.io/admit-hack/dev/engine.html (можно открыть с телефона).
- **Vercel:** импортировать репозиторий на vercel.com — настройки уже в `vercel.json` (сборка, заголовки
  `Permissions-Policy: camera=(self)`, кэш ассетов). Автодеплой из `main` включается сам.

## Архитектура

```
src/
  engine/     распознавание: MediaPipe Pose, геометрия, упражнения, правила ошибок (без React)
    types.ts  контракт движок ↔ UI
  mocks/      мок-движок для разработки UI без камеры
  ui/         экраны, компоненты, звук, голос, рекорды (React)
tests/        юнит-тесты и записанные позы
```

UI не содержит логики распознавания: он подписывается на события `Engine` (`src/engine/types.ts`) и отображает их.

### Как подключить движок в UI

Движок берётся только через фабрику: она сама решает, отдать мок или реальный движок.

```ts
import { createEngine } from '../engine/createEngine';

const engine = await createEngine(); // ?mock=1 в адресе → мок-движок
const off = engine.on((e) => {
  // e: EngineEvent из контракта
  if (e.type === 'rep') setCount(e.count);
});
await engine.start(videoEl);
engine.setMode({ exercise: 'squat', targetReps: 10 });
// при размонтировании
off();
engine.stop();
```

### Мок-движок (разработка UI без камеры)

`src/mocks/mockEngine.ts` реализует тот же интерфейс `Engine` и по таймеру шлёт все события контракта.

- `engine.start(video)` без последующего `setMode` запускает **полный автосценарий по кругу**:
  калибровка (`partial` → `too_close` → `ok`) → меню (курсор ходит, теряется, `both_hands_up`) →
  сет из 5 повторений (фазы, `rep` с оценкой, `form_error`, `form_ok`) → `set_complete`,
  затем следующее упражнение: приседания → звёздочка → выпады → подъём рук.
- Как только UI вызвал `setMode`, автосценарий отключается и мок играет только заданный режим.
- `frame` содержит настоящие 33 точки MediaPipe (синтетический скелет), поэтому `SkeletonCanvas`
  и подсветка суставов отлаживаются без камеры: в позе видно саму ошибку — мелкий присед, колени внутрь, наклон.
- Ошибки берутся из каталога `src/engine/hints.ts` (тексты из плана, §3), у каждой свои `joints`, `arrow`, `severity`.

```ts
import { createMockEngine } from '../mocks/mockEngine';

const engine = createMockEngine({ speed: 2, autoRun: false, seed: 42 });
```

| Опция     | По умолчанию | Что делает                                   |
| --------- | ------------ | -------------------------------------------- |
| `fps`     | `30`         | частота событий `frame`                      |
| `speed`   | `1`          | ускорение сценария                           |
| `autoRun` | `true`       | играть автосценарий, если `setMode` не звали |
| `seed`    | фиксирован   | воспроизводимые оценки повторений            |

Договорённости, которых нет в типах: `pointer.x/y` — **нормализованные 0..1** (доля ширины и высоты кадра,
уже зеркально, как на видео), `frame.landmarks` — нормализованные координаты MediaPipe.

## Стек

Vite · React · TypeScript · MediaPipe Tasks Vision (PoseLandmarker) · Vitest · ESLint · Prettier

## Заготовки

Весь код написан после старта хакатона (28.09, 07:00). Заранее подготовленных заготовок нет.
