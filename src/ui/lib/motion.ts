import type { CSSProperties } from 'react';

/** Порядок в каскадном появлении (класс .rise): style={order(n)}. */
export const order = (i: number): CSSProperties => ({ '--i': i }) as CSSProperties;
