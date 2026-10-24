"use client";
export default function ErrorPage({ reset }: { reset: () => void }) {
  return (
    <main className="p-8">
      <h1 className="text-xl font-semibold">We couldn’t load this page</h1>
      <p className="my-4">Please try again. If this continues, contact the administrator.</p>
      <button type="button" onClick={reset} className="rounded-lg border px-4 py-3">
        Try again
      </button>
    </main>
  );
}
