import { CameraError, openCamera, toCameraError } from '../src/engine/camera';

const domError = (name: string) => Object.assign(new Error(name), { name });

describe('ошибки камеры', () => {
  it.each([
    ['NotAllowedError', 'denied'],
    ['SecurityError', 'denied'],
    ['NotFoundError', 'not_found'],
    ['OverconstrainedError', 'not_found'],
    ['NotReadableError', 'busy'],
    ['AbortError', 'busy'],
    ['WhateverError', 'unknown'],
  ])('%s → %s', (name, code) => {
    const err = toCameraError(domError(name));
    expect(err).toBeInstanceOf(CameraError);
    expect(err.code).toBe(code);
  });

  it('у каждой ошибки понятный текст на русском', () => {
    for (const code of ['insecure', 'unsupported', 'denied', 'not_found', 'busy', 'unknown'] as const) {
      const { message } = new CameraError(code);
      expect(message.length).toBeGreaterThan(20);
      expect(message).toMatch(/[а-яё]/i);
    }
  });

  it('CameraError проходит насквозь без повторной обёртки', () => {
    const original = new CameraError('busy');
    expect(toCameraError(original)).toBe(original);
  });

  it('без mediaDevices честно говорит, что браузер не умеет камеру', async () => {
    await expect(openCamera({} as HTMLVideoElement)).rejects.toMatchObject({ code: 'unsupported' });
  });
});
