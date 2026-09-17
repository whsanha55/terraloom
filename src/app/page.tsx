import { GeneratorPanel } from "@/ui/worldgen/GeneratorPanel";

export default function Home() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-lg bg-background p-6">
      <div className="text-center">
        <h1 className="text-2xl font-bold tracking-tight text-text">World Observatory</h1>
        <p className="mt-xs text-text-muted">시드 기반 세계 생성 — Milestone 1 진행 중</p>
      </div>
      <GeneratorPanel />
    </main>
  );
}
