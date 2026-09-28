import { nextTimestamp, preferredDelegate, toLandmarks } from '../src/engine/pose';

describe('pose', () => {
  it('toLandmarks переводит visibility в v и сохраняет координаты', () => {
    const out = toLandmarks([
      { x: 0.1, y: 0.2, z: -0.3, visibility: 0.9 },
      { x: 0.5, y: 0.6, z: 0, visibility: 0 },
    ]);
    expect(out).toEqual([
      { x: 0.1, y: 0.2, z: -0.3, v: 0.9 },
      { x: 0.5, y: 0.6, z: 0, v: 0 },
    ]);
  });

  it('программный WebGL не считается GPU', () => {
    expect(
      preferredDelegate('ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero)), SwiftShader driver)'),
    ).toBe('CPU');
    expect(preferredDelegate('llvmpipe (LLVM 15.0.7, 256 bits)')).toBe('CPU');
    expect(preferredDelegate('ANGLE (Microsoft, Microsoft Basic Render Driver Direct3D11)')).toBe('CPU');
    expect(preferredDelegate(null)).toBe('CPU');
    expect(preferredDelegate('ANGLE (AMD, AMD Radeon Graphics (radeonsi, renoir), OpenGL 4.6)')).toBe('GPU');
    expect(preferredDelegate('ANGLE (Intel, Intel(R) UHD Graphics 620 Direct3D11 vs_5_0 ps_5_0)')).toBe(
      'GPU',
    );
    expect(preferredDelegate('Apple GPU')).toBe('GPU');
  });

  it('метки времени для MediaPipe строго растут, даже если часы стоят', () => {
    let ts = -1;
    const seen: number[] = [];
    for (const now of [100, 100, 100, 150, 140]) {
      ts = nextTimestamp(ts, now);
      seen.push(ts);
    }
    expect(seen).toEqual([100, 101, 102, 150, 151]);
  });
});
