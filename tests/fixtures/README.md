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

Файлы, полученные из материалов под CC BY-SA, распространяются на тех же условиях (CC BY-SA 4.0)
с указанием авторов выше.

## Как пересобрать

```bash
# видео кладём в .cache/videos (в git не попадает)
node scripts/extract-fixtures.mjs jobs.json
# jobs.json: [{ "video": ".cache/videos/x.webm", "out": "tests/fixtures/x.json", "fps": 30, "from": 2.5, "to": 30 }]
```
