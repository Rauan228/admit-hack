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
| `push-up-front.json` | 31 отжимание в «дуэли» (референс для E-31): видео ускорено ~5×, время кадров — по таймеру приложения на экране | лицом к камере, телефон на полу | 31; время каждого отжимания совпадает с приложением | TikTok @repchampapp «VS David Goggins — Push Up Battle» (передан командой как референс) | не свободная: хранятся только координаты точек, видео нет |
| `high-knees-front.json` | 13 поочерёдных подъёмов колена за 21 с (по одному каждые ~1,45 с), размечено по кадрам 8/с и пикам колен | анфас, камера низко, в конце наезд (стопы у края) | 13 | [Pexels 6326808](https://www.pexels.com/video/6326808/), Pavel Danilyuk | Pexels License |
| `high-knees-three-quarter.json` | ~17 подъёмов, последний обрезан концом ролика | вполоборота | 16 ± 1 | [Pexels 5025964](https://www.pexels.com/video/5025964/), olia danilevich | Pexels License |
| `jump-squat-front.json` | 9 приседов с выпрыгиванием, десятый обрезан концом ролика | анфас/вполоборота | 9 | [Pexels 5025962](https://www.pexels.com/video/5025962/), olia danilevich | Pexels License |
| `side-bend-front.json` | ролик начинается в наклоне; 6 наклонов с возвратом, седьмой обрезан | анфас, рука над головой | 6 | [Pexels 5025959](https://www.pexels.com/video/5025959/), olia danilevich | Pexels License |
| `side-bend-hold.json` | по одному наклону в каждую сторону с удержанием | анфас, наклоны с удержанием ~2 с | 2 | [Pexels 5510095](https://www.pexels.com/video/5510095/), Maksim Goncharenok | Pexels License |
| `jumping-jack-front-2.json` | 9 «звёздочек» | анфас | 9 | [Pexels 7746545](https://www.pexels.com/video/7746545/), Polina Tankilevitch | Pexels License |
| `jumping-jack-slow.json` | 10 «звёздочек» | анфас, пожилой человек, медленный темп | 10 | [Pexels 7299359](https://www.pexels.com/video/7299359/), Kindel Media | Pexels License |
| `squat-sumo-front.json` | 5 приседов не до параллели (бедро ~35–40° ниже горизонтали) — «сядь глубже» по делу | анфас, широкая стойка (плие), руки вперёд | 5 | [Pexels 4764175](https://www.pexels.com/video/4764175/), Gustavo Fring | Pexels License |
| `burpee-front.json` | ролик начинается в упоре лёжа (первое бёрпи обрезано); 2 полных бёрпи с отжиманием и прыжком | анфас | 2 | [Pexels 4260553](https://www.pexels.com/video/4260553/), Michelangelo Buonarroti (Pexels) | Pexels License |
| `push-up-floor-front.json` | 3 медленных отжимания; первое — вполглубины, на границе засчёта (на 15 FPS — попытка с «опускайся ниже») | лицом к камере, телефон на полу у головы (как в дуэли) | 3 ± 1 | [Pexels 8402110](https://www.pexels.com/video/8402110/), RDNE Stock project | Pexels License |
| `push-up-front-three-quarter.json` | 4 отжимания | спереди-вполоборота со стороны головы, тёмный кадр | 4 | [Pexels 4367576](https://www.pexels.com/video/4367576/), Pavel Danilyuk | Pexels License |
| `plank-straight-arms-front.json` | удержание 27,4 с; повтор = секунда (первые ~0,8 с — подтверждение) | лицом к камере, упор на прямых руках, темно | 26 ± 1 | [Pexels 4325592](https://www.pexels.com/video/4325592/), cottonbro studio | Pexels License |
| `plank-forearms-front.json` | удержание 26,3 с; повтор = секунда | лицом к камере, на предплечьях, в конце затемнение | 25 ± 1 | [Pexels 7801720](https://www.pexels.com/video/7801720/), Pavel Danilyuk | Pexels License |
| `lunge-three-quarter.json` | 5 выпадов (каждое движение — half_rep) | вполоборота-анфас | 5 | [Pexels 5025833](https://www.pexels.com/video/5025833/), olia danilevich | Pexels License |
| `arm-circles-big.json` | ~10 больших кругов; «руки ниже плеч» по делу — вариант упражнения с низом | анфас, большие круги (руки проходят низ) | 9 ± 1 | [Pexels 5510083](https://www.pexels.com/video/5510083/), Maksim Goncharenok | Pexels License |

Файлы, полученные из материалов под CC BY-SA, распространяются на тех же условиях (CC BY-SA 4.0)
с указанием авторов выше. Ролики Pexels — Pexels License (бесплатно, атрибуция не обязательна; авторы всё
равно указаны), в репозитории только координаты точек.

## Как записать себя

Стенд движка (`npm run dev` → http://localhost:5173/dev/engine.html или боевой
https://forma.178.88.115.213.sslip.io/dev/engine.html): «Старт» → режим упражнения → «● Запись» →
сделать подход → «■ Стоп и скачать». Скачается JSON в этом же формате (сырые точки до сглаживания).
Положить в `tests/fixtures/`, дописать в `meta.expected` число повторов (и ошибки, если нужны) —
тест `tests/fixtures.test.ts` подхватит файл сам.

## Как пересобрать

```bash
# видео кладём в .cache/videos (в git не попадает)
node scripts/extract-fixtures.mjs jobs.json
# jobs.json: [{ "video": ".cache/videos/x.webm", "out": "tests/fixtures/x.json", "fps": 30, "from": 2.5, "to": 30 }]
```
