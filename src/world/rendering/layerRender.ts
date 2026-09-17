/**
 * 지도 레이어 렌더링 (Step 3) — 바이옴(범주형)·온도/습도(순차형 램프).
 *
 * §26 색 유형: 범주형은 밝기 대비 팔레트, 연속형은 단색 계열 순차 램프.
 * 램프는 Viridis 계열 색으로 색약 안전을 지킨다.
 */
import { BIOME_INFO, Biome } from "@/world/generation/biome";
import type { Rgb } from "./elevationRender";

/** 고도 렌더링과 같은 3정지 순차 램프 — low → mid → high */
export function renderScalarRGBA(
  values: Float32Array,
  width: number,
  height: number,
  low: Rgb = [49, 46, 129],
  mid: Rgb = [33, 145, 140],
  high: Rgb = [253, 231, 97],
): Uint8ClampedArray {
  if (values.length !== width * height) {
    throw new RangeError(
      `레이어 배열 크기(${values.length})가 ${width}×${height}와 일치하지 않습니다`,
    );
  }
  const rgba = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < values.length; i++) {
    const t = values[i] < 0 ? 0 : values[i] > 1 ? 1 : values[i];
    const color = t < 0.5 ? mixColor(low, mid, t * 2) : mixColor(mid, high, (t - 0.5) * 2);
    const o = i * 4;
    rgba[o] = color[0];
    rgba[o + 1] = color[1];
    rgba[o + 2] = color[2];
    rgba[o + 3] = 255;
  }
  return rgba;
}

function mixColor(a: Rgb, b: Rgb, t: number): Rgb {
  const k = t < 0 ? 0 : t > 1 ? 1 : t;
  return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
}

/** 바이옴 레이어를 범주형 팔레트로 렌더링한다 */
export function renderBiomeRGBA(
  biome: Uint8Array,
  width: number,
  height: number,
): Uint8ClampedArray {
  if (biome.length !== width * height) {
    throw new RangeError(
      `바이옴 배열 크기(${biome.length})가 ${width}×${height}와 일치하지 않습니다`,
    );
  }
  const rgba = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < biome.length; i++) {
    const info = BIOME_INFO[biome[i] as Biome] ?? BIOME_INFO[Biome.Ocean];
    const o = i * 4;
    rgba[o] = info.color[0];
    rgba[o + 1] = info.color[1];
    rgba[o + 2] = info.color[2];
    rgba[o + 3] = 255;
  }
  return rgba;
}
