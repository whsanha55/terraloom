/**
 * 고도 레이어 렌더링(Step 2) — 바다/육지 색 분리 + 그레이스케일 램프.
 *
 * 색약 안전(§26): 육지는 단색 순차형 그라데이션, 바다는 깊이 음영.
 * 렌더링은 순수 함수 — UI는 결과를 Canvas에 올리기만 한다(§31).
 */
export type Rgb = readonly [number, number, number];

export interface ElevationPalette {
  oceanDeep: Rgb;
  oceanShallow: Rgb;
  landLow: Rgb;
  landHigh: Rgb;
}

export const DEFAULT_ELEVATION_PALETTE: ElevationPalette = {
  oceanDeep: [15, 32, 54],
  oceanShallow: [38, 64, 96],
  landLow: [96, 106, 120],
  landHigh: [237, 240, 243],
};

function clamp01(value: number): number {
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

function mixColor(a: Rgb, b: Rgb, t: number): Rgb {
  const k = clamp01(t);
  return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
}

/** 고도장을 RGBA 픽셀 버퍼로 변환한다 */
export function renderElevationRGBA(
  elevation: Float32Array,
  width: number,
  height: number,
  seaLevel: number,
  palette: ElevationPalette = DEFAULT_ELEVATION_PALETTE,
): Uint8ClampedArray {
  if (elevation.length !== width * height) {
    throw new RangeError(
      `고도 배열 크기(${elevation.length})가 ${width}×${height}와 일치하지 않습니다`,
    );
  }
  const rgba = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < elevation.length; i++) {
    const e = elevation[i];
    let color: Rgb;
    if (e < seaLevel) {
      const depth = seaLevel > 0 ? (seaLevel - e) / seaLevel : 1; // 분모 가드(§8.1)
      color = mixColor(palette.oceanShallow, palette.oceanDeep, depth);
    } else {
      const span = 1 - seaLevel;
      const height01 = span > 0 ? (e - seaLevel) / span : 0;
      color = mixColor(palette.landLow, palette.landHigh, height01);
    }
    const o = i * 4;
    rgba[o] = color[0];
    rgba[o + 1] = color[1];
    rgba[o + 2] = color[2];
    rgba[o + 3] = 255;
  }
  return rgba;
}
