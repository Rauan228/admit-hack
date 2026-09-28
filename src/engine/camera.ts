// Камера: getUserMedia с фронталкой и понятные ошибки на русском.
// UI показывает CameraError.message как есть и по code решает, какую инструкцию дать.

import { ENGINE_CONFIG } from './config';

export type CameraErrorCode = 'insecure' | 'unsupported' | 'denied' | 'not_found' | 'busy' | 'unknown';

const CAMERA_MESSAGES: Record<CameraErrorCode, string> = {
  insecure: 'Камера работает только по HTTPS. Открой защищённую ссылку.',
  unsupported: 'Этот браузер не даёт доступ к камере. Открой сайт в Chrome, Edge или Safari.',
  denied:
    'Нет доступа к камере. Разреши камеру в настройках сайта (значок замка в адресной строке) и обнови страницу.',
  not_found: 'Камера не найдена. Подключи камеру и обнови страницу.',
  busy: 'Камера занята другим приложением. Закрой Zoom, Teams или другую вкладку с камерой и обнови страницу.',
  unknown: 'Не удалось включить камеру. Обнови страницу и попробуй ещё раз.',
};

export class CameraError extends Error {
  readonly code: CameraErrorCode;

  constructor(code: CameraErrorCode, cause?: unknown) {
    super(CAMERA_MESSAGES[code], { cause });
    this.name = 'CameraError';
    this.code = code;
  }
}

/** Переводит ошибку getUserMedia (DOMException) в CameraError с понятным текстом. */
export function toCameraError(err: unknown): CameraError {
  if (err instanceof CameraError) return err;
  const name = (err as { name?: unknown } | null)?.name;
  switch (name) {
    case 'NotAllowedError':
    case 'SecurityError':
      return new CameraError('denied', err);
    case 'NotFoundError':
    case 'OverconstrainedError':
      return new CameraError('not_found', err);
    case 'NotReadableError':
    case 'AbortError':
      return new CameraError('busy', err);
    default:
      return new CameraError('unknown', err);
  }
}

/** Включает камеру и подключает поток к video. Возвращает поток, чтобы потом его остановить. */
export async function openCamera(video: HTMLVideoElement): Promise<MediaStream> {
  if (globalThis.isSecureContext === false) throw new CameraError('insecure');
  const mediaDevices = globalThis.navigator?.mediaDevices;
  if (!mediaDevices?.getUserMedia) throw new CameraError('unsupported');

  const { facingMode, width, height, frameRate } = ENGINE_CONFIG.camera;
  let stream: MediaStream;
  try {
    stream = await mediaDevices.getUserMedia({
      audio: false,
      video: {
        facingMode,
        width: { ideal: width },
        height: { ideal: height },
        frameRate: { ideal: frameRate },
      },
    });
  } catch (err) {
    throw toCameraError(err);
  }

  // muted + playsInline обязательны, иначе iOS Safari не запустит видео без жеста.
  video.muted = true;
  video.playsInline = true;
  video.srcObject = stream;
  try {
    await video.play();
  } catch (err) {
    stopCamera(stream);
    throw toCameraError(err);
  }
  return stream;
}

export function stopCamera(stream: MediaStream | null): void {
  stream?.getTracks().forEach((track) => track.stop());
}
