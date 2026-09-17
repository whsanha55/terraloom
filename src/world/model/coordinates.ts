/**
 * 지도 셀 좌표 ↔ row-major 인덱스 변환 (§10.2 TypedArray 레이어 접근).
 * 월드젠·시뮬레이션 전체가 이 변환을 공유한다.
 */
export interface Cell {
  x: number;
  y: number;
}

export function cellIndex(x: number, y: number, width: number): number {
  return y * width + x;
}

export function cellCoords(index: number, width: number): Cell {
  return { x: index % width, y: Math.floor(index / width) };
}

export function isInBounds(x: number, y: number, width: number, height: number): boolean {
  return (
    Number.isInteger(x) &&
    Number.isInteger(y) &&
    x >= 0 &&
    y >= 0 &&
    x < width &&
    y < height
  );
}

export function assertInBounds(x: number, y: number, width: number, height: number): void {
  if (!isInBounds(x, y, width, height)) {
    throw new RangeError(`셀 (${x}, ${y})이(가) ${width}×${height} 지도 범위를 벗어났습니다`);
  }
}
