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
  return (
    <main className="screen screen--center status" role="alert">
      <span className="status__icon status__icon--bad">
        <Icon name="camera" size={44} />
      </span>
      <h2 className="status__title">{message}</h2>
      <p className="status__text muted">{HOW_TO_FIX[code] ?? HOW_TO_FIX.unknown}</p>
      <div className="row status__actions">
        <button type="button" className="btn btn--primary btn--lg" onClick={onRetry}>
          <Icon name="retry" /> Попробовать снова
        </button>
        <button type="button" className="btn btn--ghost" onClick={onDemo}>
          Демо без камеры
        </button>
      </div>
    </main>
  );
}
