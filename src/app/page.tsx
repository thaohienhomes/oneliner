export default function Home() {
  return (
    <main className="font-sans flex min-h-screen items-center justify-center p-8 sm:p-20">
      <div className="flex w-full max-w-3xl flex-col gap-6">
        <h1 className="text-4xl font-bold tracking-tight sm:text-5xl">
          LoglineReel
        </h1>
        <label htmlFor="logline" className="sr-only">
          Your story in one sentence
        </label>
        <input
          id="logline"
          name="logline"
          type="text"
          placeholder="Your story in one sentence"
          className="w-full rounded-2xl border border-black/[.12] dark:border-white/[.2] bg-transparent px-6 py-5 text-2xl sm:text-3xl outline-none focus:border-foreground"
        />
        <button
          type="button"
          disabled
          className="self-start rounded-full bg-foreground text-background px-8 py-4 text-lg font-medium disabled:cursor-not-allowed disabled:opacity-40"
        >
          Make trailer
        </button>
      </div>
    </main>
  );
}
