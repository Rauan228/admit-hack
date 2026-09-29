// Снимок кадра камеры (E-23): модель считает точки по снимку, а экран рисует тот же снимок — скелет лежит
// на теле кадр в кадр. Раньше экран рисовал живое видео: пока модель думает (16 мс на ноутбуке при кадре
// камеры 33 мс), видео уходит на кадр вперёд, и на быстрых движениях скелет отставал от руки в среднем
// на 11 см (до 22 см). Экран со снимком запаздывает за живым видео в среднем на полкадра — глазу незаметно.
//
// Холстов два, по очереди: модель пишет в один, экран рисует другой. Если детекция упала, на экране
// остаётся прошлый кадр вместе со своими точками — картинка и скелет не расходятся.

/** Кадр для модели и для экрана: видео или холст. */
export type FrameSource = HTMLVideoElement | HTMLCanvasElement | OffscreenCanvas;

/** Размер кадра в пикселях: у видео — размер потока, у холста — его размер. */
export function sourceSize(src: FrameSource): { w: number; h: number } {
  return 'videoWidth' in src ? { w: src.videoWidth, h: src.videoHeight } : { w: src.width, h: src.height };
}

export interface SnapshotCanvas {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
}

/** Холст для снимка; null — в этом окружении холстов нет (тесты, воркер без DOM). */
function browserCanvas(): SnapshotCanvas | null {
  if (typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  // Без willReadFrequently: холст остаётся на видеокарте, копия кадра — копия на видеокарте.
  const ctx = canvas.getContext('2d');
  return ctx ? { canvas, ctx } : null;
}

export class FrameSnapshots {
  private readonly slots: (SnapshotCanvas | null)[] = [null, null];
  private back = 0;
  private front: HTMLCanvasElement | null = null;
  private broken = false;

  constructor(private readonly create: () => SnapshotCanvas | null = browserCanvas) {}

  /** Кадр, на котором посчитаны последние точки; null — снимков нет, экран рисует видео. */
  get frame(): HTMLCanvasElement | null {
    return this.front;
  }

  /** Копирует текущий кадр видео в свободный холст. null — снимок недоступен: модель берёт само видео. */
  capture(video: HTMLVideoElement): HTMLCanvasElement | null {
    if (this.broken) return null;
    const { w, h } = sourceSize(video);
    if (!(w > 0 && h > 0)) return null;
    let slot = this.slots[this.back] ?? null;
    if (!slot) {
      slot = this.create();
      if (!slot) {
        this.broken = true;
        return null;
      }
      this.slots[this.back] = slot;
    }
    if (slot.canvas.width !== w || slot.canvas.height !== h) {
      slot.canvas.width = w;
      slot.canvas.height = h;
    }
    try {
      slot.ctx.drawImage(video, 0, 0, w, h);
    } catch {
      return null;
    }
    return slot.canvas;
  }

  /** Детекция по снимку прошла: он становится кадром на экране, следующий снимок — в другой холст. */
  commit(): void {
    const slot = this.slots[this.back];
    if (!slot) return;
    this.front = slot.canvas;
    this.back = 1 - this.back;
  }
}
