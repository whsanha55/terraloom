/**
 * 강 생성 (Step 4) — 함몰 보정(priority flood) + 유량 누적.
 *
 * 1. 바다 셀을 시드로 priority flood를 돌려 함몰 보정 고도(filled)와
 *    각 육지 셀의 배수 방향(target)을 함께 확정한다.
 *    함몰(피트)은 filled를 끌어올려 막힘 없이 바다까지 흐르게 한다.
 *    힙 키는 푸시 시점에 확정되고 이후 불변이므로 불변식이 유지된다.
 * 2. 발견 순서의 **역순**으로 유량을 누적한다 — 상류(늦게 발견)부터
 *    처리해야 하류로 넘길 물이 완성된다.
 * 3. riverVolume = 유량 / 최대 유량 (정규화 [0,1]).
 *
 * 동률(tie)은 항상 (filled elevation, 셀 인덱스) 사전 순으로 깨진다 — 결정론.
 */
import type { WorldMap } from "@/world/model/worldMap";

/** 이진 최소힙 — 셀 인덱스를 (filled elevation, index) 순으로 정렬 */
class CellHeap {
  private readonly items: number[] = [];

  constructor(private readonly filled: Float32Array) {}

  private less(a: number, b: number): boolean {
    const ea = this.filled[a];
    const eb = this.filled[b];
    if (ea !== eb) return ea < eb;
    return a < b;
  }

  push(item: number): void {
    this.items.push(item);
    let i = this.items.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (!this.less(this.items[i], this.items[parent])) break;
      const t = this.items[i];
      this.items[i] = this.items[parent];
      this.items[parent] = t;
      i = parent;
    }
  }

  pop(): number {
    const top = this.items[0];
    const last = this.items.pop();
    if (this.items.length > 0 && last !== undefined) {
      this.items[0] = last;
      let i = 0;
      for (;;) {
        const left = i * 2 + 1;
        const right = left + 1;
        let smallest = i;
        if (left < this.items.length && this.less(this.items[left], this.items[smallest])) {
          smallest = left;
        }
        if (right < this.items.length && this.less(this.items[right], this.items[smallest])) {
          smallest = right;
        }
        if (smallest === i) break;
        const t = this.items[i];
        this.items[i] = this.items[smallest];
        this.items[smallest] = t;
        i = smallest;
      }
    }
    return top;
  }

  get length(): number {
    return this.items.length;
  }
}

export function generateRivers(map: WorldMap, seaLevel: number): void {
  const { width, height, elevation } = map;
  const size = width * height;

  const filled = new Float32Array(size);
  const visited = new Uint8Array(size);
  const targets = new Int32Array(size).fill(-1);
  const discoveryOrder: number[] = [];
  const heap = new CellHeap(filled);

  for (let i = 0; i < size; i++) {
    filled[i] = elevation[i];
    if (elevation[i] < seaLevel) {
      visited[i] = 1;
      heap.push(i);
    }
  }

  while (heap.length > 0) {
    const current = heap.pop();
    const cx = current % width;
    const cy = (current - (current % width)) / width;
    const visit = (nb: number): void => {
      if (visited[nb]) return;
      visited[nb] = 1;
      filled[nb] = Math.max(elevation[nb], filled[current]); // 함몰 보정
      targets[nb] = current;
      discoveryOrder.push(nb);
      heap.push(nb);
    };
    if (cx > 0) visit(current - 1);
    if (cx < width - 1) visit(current + 1);
    if (cy > 0) visit(current - width);
    if (cy < height - 1) visit(current + width);
  }

  // 유량 누적 — 역발견 순서(상류부터). 각 셀의 강수는 1.
  const acc = new Float32Array(size);
  for (let k = discoveryOrder.length - 1; k >= 0; k--) {
    const cell = discoveryOrder[k];
    acc[cell] += 1;
    const target = targets[cell];
    if (target >= 0) {
      acc[target] += acc[cell];
    }
  }

  // 정규화 — riverVolume [0,1]. 분모 가드(§8.1)
  let maxAcc = 0;
  for (const v of acc) {
    if (v > maxAcc) maxAcc = v;
  }
  if (maxAcc <= 0) {
    map.riverVolume.fill(0);
    return;
  }
  for (let i = 0; i < size; i++) {
    map.riverVolume[i] = acc[i] / maxAcc;
  }
}
