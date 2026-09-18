"use client";

import { useState } from "react";
import type { EventNotice } from "@/simulation/events/engine";

interface EventTimelineProps {
  /** 최신 순 누적 로그 */
  events: EventNotice[];
  selectedEventId: string | null;
  onSelect: (eventId: string) => void;
}

const FILTERS = [
  { id: "all", label: "전체", min: 0 },
  { id: "major", label: "중요+", min: 50 },
  { id: "critical", label: "대형+", min: 80 },
] as const;

/** 이벤트 타임라인 (§25 하단 마스터의 Step 10 버전) — 중요도 필터 포함 */
export function EventTimeline({ events, selectedEventId, onSelect }: EventTimelineProps) {
  const [filterId, setFilterId] = useState<(typeof FILTERS)[number]["id"]>("all");
  const min = FILTERS.find((f) => f.id === filterId)?.min ?? 0;
  const visible = events.filter((e) => e.importance >= min);

  return (
    <section className="mt-md" aria-label="이벤트 타임라인">
      <div className="flex flex-wrap items-center gap-sm">
        <h2 className="text-sm font-semibold text-text">타임라인</h2>
        <div role="group" aria-label="중요도 필터" className="flex overflow-hidden rounded-md border border-border">
          {FILTERS.map((filter) => (
            <button
              key={filter.id}
              type="button"
              aria-pressed={filterId === filter.id}
              onClick={() => setFilterId(filter.id)}
              className={
                filterId === filter.id
                  ? "bg-primary px-md py-xs text-sm font-medium text-on-primary"
                  : "px-md py-xs text-sm text-text-muted hover:bg-accent hover:text-text"
              }
            >
              {filter.label}
            </button>
          ))}
        </div>
        <span className="font-numeric tnum text-sm text-text-muted">
          {visible.length}/{events.length}건
        </span>
      </div>

      {events.length === 0 ? (
        <p className="mt-xs text-sm text-text-muted">아직 사건이 없습니다 — 시간을 진행하세요</p>
      ) : (
        <ul
          data-testid="event-log"
          className="mt-xs max-h-48 overflow-y-auto rounded-md border border-border bg-surface"
        >
          {visible.map((event) => (
            <li key={event.id} className="border-b border-border last:border-b-0">
              <button
                type="button"
                onClick={() => onSelect(event.id)}
                aria-pressed={selectedEventId === event.id}
                className="flex w-full items-baseline gap-md px-md py-xs text-left text-sm hover:bg-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
              >
                <span className="font-numeric tnum text-text-muted">
                  {Math.floor(event.startedTick / 12) + 1}년 {(event.startedTick % 12) + 1}월
                </span>
                <span className="text-text">
                  {event.name}
                  {event.causedByName ? (
                    <span className="text-text-muted"> ← {event.causedByName}</span>
                  ) : null}
                </span>
                <span className="text-text-muted">{event.targetName}</span>
                {event.kind === "notification" && (
                  <span className="rounded-full bg-accent px-sm text-xs text-text-muted">통지</span>
                )}
                <span className="font-numeric tnum ml-auto text-text-muted">
                  중요도 {event.importance}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
