// U-04 / U-16: камера недоступна — готовый текст ошибки из движка (CameraError) плюс что делать.

import { Icon } from '../components/Icon';
import './status.css';

const HOW_TO_FIX: Record<string, string> = {
  denied: 'Нажми на значок камеры или замка в адресной строке, разреши доступ и попробуй снова.',
  not_found: 'Подключи веб-камеру или открой ссылку на телефоне.',
  busy: 'Закрой другие приложения, которые используют камеру (Zoom, Teams, другие вкладки), и попробуй снова.',
  insecure: 'Камера работает только по https:// или на localhost. Открой приложение по защищённой ссылке.',
  unsupported: 'Открой ссылку в свежем Chrome, Edge, Safari или Firefox.',
  unknown: 'Попробуй перезагрузить страницу. Если не поможет — открой демо без камеры.',
};

/** Когда движок не знает точной причины — перечисляем частые. */
const CAUSES = [
  'Нет разрешения на доступ к камере',
  'Камера занята другим приложением (Zoom, Teams)',
  'Страница открыта не по https',
  'Старый браузер',
  'Камера не подключена',
];

export function ErrorScreen({
  message,
  code,
  onRetry,
  onDemo,
}: {
  message: string;
  code: string;
  onRetry: () => void;
  onDemo: () => void;
}) {
  const fix = code !== 'unknown' ? HOW_TO_FIX[code] : undefined;
  return (
    <main className="screen screen--center status" role="alert">
      <div className="status__panel status__panel--error">
        <span className="status__icon status__icon--bad">
          <Icon name="camera" size={30} />
        </span>
        <span className="status__tag--bad">Камера недоступна</span>
        <h2 className="status__title">{message}</h2>
        <div className="status__fix">
          <b className="status__label">{fix ? 'Что сделать' : 'Возможные причины'}</b>
          {fix ? (
            <p>{fix}</p>
          ) : (
            <>
              <ul>
                {CAUSES.map((c) => (
                  <li key={c}>{c}</li>
                ))}
              </ul>
              <p>{HOW_TO_FIX.unknown}</p>
            </>
          )}
        </div>
        <div className="status__actions">
          <button type="button" className="btn btn--primary btn--lg" onClick={onRetry}>
            <Icon name="retry" /> Попробовать снова
          </button>
          <button type="button" className="btn btn--ghost btn--lg" onClick={onDemo}>
            Демо без камеры
          </button>
        </div>
      </div>
    </main>
  );
}
