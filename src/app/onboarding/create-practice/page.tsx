import { createPracticeAction } from "./actions";

export default function CreatePracticePage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
      <form
        action={createPracticeAction}
        className="w-full max-w-md space-y-4 rounded-xl bg-white p-8 shadow"
      >
        <h1 className="text-2xl font-bold text-slate-900">Create your practice</h1>
        <p className="text-sm text-slate-500">
          Tell us the basics. You can refine details later.
        </p>
        <div>
          <label htmlFor="name" className="block text-sm font-medium text-slate-700">
            Practice name
          </label>
          <input
            id="name"
            name="name"
            required
            maxLength={200}
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
          />
        </div>
        <div>
          <label htmlFor="primaryState" className="block text-sm font-medium text-slate-700">
            Primary state
          </label>
          <input
            id="primaryState"
            name="primaryState"
            required
            maxLength={2}
            placeholder="AZ"
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 uppercase"
          />
        </div>
        <button
          type="submit"
          className="w-full rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700"
        >
          Create practice
        </button>
      </form>
    </div>
  );
}
