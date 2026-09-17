/**
 * 정수 순열 테이블 기반 밸류 노이즈 + FBM 옥타브 합성(§7.1).
 *
 * Math.sin 등 초월함수 없이 기본 산술·Math.floor·다항식 보간만 사용한다.
 * 좌표는 세계 좌표([0,1) 정규화)를 받는다 — 해상도(256/512)와 무관하게
 * 같은 시드는 같은 세계 형태를 만든다.
 */
import type { Rng } from "@/world/random/rng";

export type Noise2D = (x: number, y: number) => number;

/** 시드로 초기화한 순열 테이블을 사용하는 2차원 밸류 노이즈. 반환값 [0,1] */
export function createValueNoise2D(rng: Rng): Noise2D {
  const perm = new Uint8Array(256);
  for (let i = 0; i < 256; i++) {
    perm[i] = i;
  }
  // Fisher–Yates 셔플 — rng만 사용하므로 결정론 유지
  for (let i = 255; i > 0; i--) {
    const j = rng.nextInt(0, i + 1);
    const temp = perm[i];
    perm[i] = perm[j];
    perm[j] = temp;
  }
  // 512 크기 두 배 테이블로 격자 조회의 나머지 연산을 제거한다
  const table = new Uint8Array(512);
  for (let i = 0; i < 512; i++) {
    table[i] = perm[i & 0xff];
  }

  const latticeValue = (ix: number, iy: number): number =>
    table[table[ix & 0xff] + (iy & 0xff)] / 255;

  return (x: number, y: number): number => {
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const fx = x - x0;
    const fy = y - y0;
    // 부드러운 보간(smoothstep) — 3차 다항식
    const sx = fx * fx * (3 - 2 * fx);
    const sy = fy * fy * (3 - 2 * fy);
    const v00 = latticeValue(x0, y0);
    const v10 = latticeValue(x0 + 1, y0);
    const v01 = latticeValue(x0, y0 + 1);
    const v11 = latticeValue(x0 + 1, y0 + 1);
    const top = v00 + (v10 - v00) * sx;
    const bottom = v01 + (v11 - v01) * sx;
    return top + (bottom - top) * sy;
  };
}

export interface FbmOptions {
  octaves: number;
  /** 세계 전체를 가로지는 기본 주기 수 */
  frequency: number;
  persistence: number;
  lacunarity: number;
}

/** 프랙탈 브라운 운동(FBM) — 옥타브 합성. 반환값 [0,1] */
export function createFbm2D(noise: Noise2D, options: FbmOptions): Noise2D {
  const { octaves, frequency, persistence, lacunarity } = options;
  if (!Number.isInteger(octaves) || octaves < 1) {
    throw new RangeError(`octaves는 1 이상의 정수여야 합니다: ${octaves}`);
  }
  return (x: number, y: number): number => {
    let sum = 0;
    let amplitude = 1;
    let norm = 0;
    let freq = frequency;
    for (let octave = 0; octave < octaves; octave++) {
      sum += amplitude * noise(x * freq, y * freq);
      norm += amplitude;
      amplitude *= persistence;
      freq *= lacunarity;
    }
    return sum / norm; // octaves ≥ 1이면 norm > 0
  };
}
