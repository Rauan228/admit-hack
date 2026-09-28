// Фабрика движка: ?mock=1 отдаёт мок-движок (E-02), иначе реальный (E-14).
// UI берёт движок только отсюда и работает с интерфейсом Engine из контракта.

import type { Engine } from './types';

export interface CreateEngineOptions {
  /** Строка запроса; по умолчанию берём из адреса страницы. */
  search?: string;
  /** Принудительный выбор, минуя URL: удобно в тестах и Storybook. */
  mock?: boolean;
}

/** Мок включается через ?mock=1 (а также ?mock, ?mock=true). ?mock=0 — реальный движок. */
export function isMockRequested(search = globalThis.location?.search ?? ''): boolean {
  const value = new URLSearchParams(search).get('mock');
  if (value === null) return false;
  return value !== '0' && value !== 'false';
}

export async function createEngine(options: CreateEngineOptions = {}): Promise<Engine> {
  const useMock = options.mock ?? isMockRequested(options.search);
  if (useMock) {
    const { createMockEngine } = await import('../mocks/mockEngine');
    return createMockEngine();
  }
  const { createRealEngine } = await import('./Engine');
  return createRealEngine();
}
