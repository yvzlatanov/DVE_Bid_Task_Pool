export function FirebaseMissing() {
  return (
    <div className="min-h-screen bg-zinc-100 text-zinc-900 flex items-center justify-center p-6">
      <div className="max-w-lg rounded-2xl border border-zinc-200 bg-white p-8 shadow-sm">
        <h1 className="text-xl font-semibold tracking-tight">Firebase is not configured</h1>
        <p className="mt-3 text-sm leading-relaxed text-zinc-600">
          Add your Firebase web app credentials to a <code className="rounded bg-zinc-100 px-1.5 py-0.5 text-xs">.env</code> file
          (see <code className="rounded bg-zinc-100 px-1.5 py-0.5 text-xs">.env.example</code>), then restart the dev server. Enable
          Firestore and Storage in the Firebase console and deploy the rules in <code className="rounded bg-zinc-100 px-1.5 py-0.5 text-xs">firebase/</code>.
        </p>
      </div>
    </div>
  )
}
