# Фикстуры: записанные позы

Каждый файл — покадровые точки MediaPipe Pose (33 точки кадра + 33 мировые точки в метрах),
полученные из видео скриптом `scripts/extract-fixtures.mjs`: видео проматывается покадрово,
каждый кадр идёт через тот же `src/engine/pose.ts`, что и в приложении (модель `full`, CPU).
Само видео в репозитории не хранится — только координаты точек.

Формат: `src/engine/recorder.ts` (`FixtureFile`). В `meta` — источник, лицензия, ракурс
и ожидаемый результат (`expected`), который тесты сверяют с движком.
Ожидаемый счёт повторений размечен **вручную по раскадровке**, независимо от алгоритма.

| Файл | Что внутри | Ракурс | Ожидается | Источник | Лицензия |
|---|---|---|---|---|---|
| `squat-front-goblet.json` | 2 медленных глубоких приседа с гирей | анфас, человек мелко, сзади второй человек | 2 повтора | [Kettlebell Goblet Squat](https://commons.wikimedia.org/wiki/File:Kettlebell_Goblet_Squat.webm), Taco fleur | CC BY-SA 4.0 |
| `squat-rear-barbell.json` | 2 приседа со штангой ниже параллели | со спины | 2 повтора | [Squat — exercise demonstration video](https://commons.wikimedia.org/wiki/File:Squat_-_exercise_demonstration_video.webm), Fitness Science | CC BY 3.0 |
| `squat-side-goblet.json` | 6 глубоких приседов, между ними возня с гирей | сбоку | 6 повторов | [Squat and Frontal Raise](https://commons.wikimedia.org/wiki/File:Squat_and_Frontal_Raise.webm), Taco fleur | CC BY-SA 4.0 |
| `squat-side-backlit.json` | 6 приседов, силуэт против неба | сбоку, контровой свет | 6 повторов | [Kettlebell Racked Squats (side view)](https://commons.wikimedia.org/wiki/File:Kettlebell_Racked_Squats_(side_view).webm), Taco fleur | CC BY-SA 4.0 |
| `jumping-jack-front.json` | 6 «звёздочек», между ними бёрпи (не должны считаться) | анфас | 6 повторов, 0 ошибок | [Jumping jacks and burpees](https://commons.wikimedia.org/wiki/File:Jumping_jacks_and_burpees.webm), Taco fleur | CC BY-SA 4.0 |
| `lunge-front-hold.json` | 2 выпада с гирей над головой и поворотом корпуса, удержание внизу 11 и 13 с | анфас | 2 повтора, 0 ошибок | [Overhead Lunge and Twist](https://commons.wikimedia.org/wiki/File:Overhead_Lunge_and_Twist.webm), Taco fleur | CC BY-SA 4.0 |
| `lunge-front-backlit.json` | 5 обратных выпадов со сменой ног, между ними рывок гири; левая нога в силуэте почти не видна | анфас, против света | 5 ± 1 повтор; 3 выпада с правой ногой сзади — без ошибок | [Dead Snatch into Reverse Lunge](https://commons.wikimedia.org/wiki/File:Dead_Snatch_into_Reverse_Lunge.webm), Taco fleur | CC BY-SA 4.0 |
| `squat-press-kettlebell.json` | Комплекс с гирями: 2 приседа с жимом над головой и 2 рывка без приседа | вполоборота, камера снизу | 4 ± 1 движения; жимы с приседом без ошибок, рывки — только «сядь глубже» | [Kettlebell Dead Clean Squat Thruster Snatch](https://commons.wikimedia.org/wiki/File:Kettlebell_Dead_Clean_Squat_Thruster_Snatch.webm), Taco fleur | CC BY-SA 4.0 |

Файлы, полученные из материалов под CC BY-SA, распространяются на тех же условиях (CC BY-SA 4.0)
с указанием авторов выше.

## Как записать себя

Стенд движка (`npm run dev` → http://localhost:5173/dev/engine.html или боевой
https://abdigaliarslan.github.io/admit-hack/dev/engine.html): «Старт» → режим упражнения → «● Запись» →
сделать подход → «■ Стоп и скачать». Скачается JSON в этом же формате (сырые точки до сглаживания).
Положить в `tests/fixtures/`, дописать в `meta.expected` число повторов (и ошибки, если нужны) —
тест `tests/fixtures.test.ts` подхватит файл сам.

## Как пересобрать

```bash
# видео кладём в .cache/videos (в git не попадает)
node scripts/extract-fixtures.mjs jobs.json
# jobs.json: [{ "video": ".cache/videos/x.webm", "out": "tests/fixtures/x.json", "fps": 30, "from": 2.5, "to": 30 }]
```
