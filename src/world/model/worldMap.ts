/**
 * 지도 레이어 모델 (§10.2).
 *
 * 지도는 시드로 재생성 가능하므로(§7) 스냅샷 저장 대상에서 제외된다(§28.3).
 * 각 레이어는 width×height 크기의 row-major 배열이다.
 */
export interface WorldMap {
  width: number;
  height: number;

  elevation: Float32Array;
  temperature: Float32Array;
  moisture: Float32Array;
  fertility: Float32Array;

  biome: Uint8Array;
  riverVolume: Float32Array;
  regionId: Uint32Array;
}

/** 0으로 초기화된 지도 레이어 7종을 할당한다 */
export function createWorldMap(width: number, height: number): WorldMap {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
    throw new RangeError(`지도 크기는 양의 정수여야 합니다: ${width}×${height}`);
  }
  const size = width * height;
  return {
    width,
    height,
    elevation: new Float32Array(size),
    temperature: new Float32Array(size),
    moisture: new Float32Array(size),
    fertility: new Float32Array(size),
    biome: new Uint8Array(size),
    riverVolume: new Float32Array(size),
    regionId: new Uint32Array(size),
  };
}
