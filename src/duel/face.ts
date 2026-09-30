// Буква ника в круге. Рамка — data-frame, стили в ui/styles/frames.css.

export function letter(name: string): string {
  return (name.trim().slice(0, 1) || '?').toUpperCase();
}

export function face(name: string, frame: string | null, size = 28): HTMLSpanElement {
  const wrap = document.createElement('span');
  wrap.className = 'face';
  wrap.style.setProperty('--face-size', `${size}px`);
  const disc = document.createElement('span');
  disc.className = 'face__disc';
  wrap.append(disc);
  setFace(wrap, name, frame, null);
  return wrap;
}

export function setFace(wrap: HTMLElement, name: string, frame: string | null, title: string | null): void {
  if (frame) wrap.dataset.frame = frame;
  else delete wrap.dataset.frame;
  if (title) wrap.title = title;
  else wrap.removeAttribute('title');
  const disc = wrap.querySelector('.face__disc');
  if (disc) disc.textContent = letter(name);
}
