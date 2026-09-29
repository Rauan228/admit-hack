// Адреса страниц: лендинг — отдельно, платформа — /app. Обновление страницы оставляет там, где был:
// /app — меню (камера включится сама), /app/rating и /app/progress открываются сразу, /demo — объяснение демо.
// Экраны внутри тренировки (интро, подход, итоги) своих адресов не имеют: после обновления — меню.

export type Route = 'landing' | 'demo' | 'app' | 'rating' | 'progress' | 'login';

const PATHS: Record<Route, string> = {
  landing: '/',
  demo: '/demo',
  app: '/app',
  rating: '/app/rating',
  progress: '/app/progress',
  login: '/app/login',
};

const BASE = (import.meta.env.BASE_URL ?? '/').replace(/\/$/, '');

export function currentRoute(pathname = globalThis.location?.pathname ?? '/'): Route {
  const p = (pathname.startsWith(BASE) ? pathname.slice(BASE.length) : pathname).replace(/\/+$/, '') || '/';
  const hit = (Object.entries(PATHS) as [Route, string][]).find(([, path]) => path === p);
  if (hit) return hit[0];
  return p.startsWith('/app') ? 'app' : 'landing';
}

/** Экран → адрес. Демо-тур целиком живёт на /demo. */
export function routeOf(screen: string, tour: boolean): Route {
  if (screen === 'landing') return 'landing';
  if (screen === 'demo' || tour) return 'demo';
  if (screen === 'leaderboard') return 'rating';
  if (screen === 'profile') return 'progress';
  if (screen === 'auth') return 'login';
  return 'app';
}

/** Поставить адрес (с сохранением ?mock и прочих параметров), если он другой. */
export function syncUrl(route: Route): void {
  if (currentRoute() === route) return;
  const url = new URL(window.location.href);
  url.pathname = BASE + PATHS[route];
  window.history.pushState({ route }, '', url);
}

const CALIBRATED = 'forma.calibrated.v1';

/** Калибровку уже прошли в этой вкладке — после обновления страницы сразу в меню. */
export function wasCalibrated(): boolean {
  try {
    return sessionStorage.getItem(CALIBRATED) === '1';
  } catch {
    return false;
  }
}

export function markCalibrated(): void {
  try {
    sessionStorage.setItem(CALIBRATED, '1');
  } catch {
    /* без хранилища — просто покажем калибровку ещё раз */
  }
}
