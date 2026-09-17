export default function Home() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-background p-6">
      <section className="w-full max-w-md rounded-lg border border-border bg-surface p-xl shadow-panel">
        <p className="font-numeric tnum text-text-muted">terraloom</p>
        <h1 className="mt-xs text-2xl font-bold tracking-tight text-text">World Observatory</h1>
        <p className="mt-sm text-text-muted">
          절차적으로 생성된 세계를 관찰하고 개입하는 시뮬레이션 콘솔
        </p>
        <div className="mt-xl rounded-md border border-border bg-accent p-md text-text-muted">
          Step 0 완료 — 실행·테스트·린트·빌드·CI 기반 구축. 세계 생성은 Milestone 1(Step 1~2)에서
          추가된다.
        </div>
      </section>
    </main>
  );
}
