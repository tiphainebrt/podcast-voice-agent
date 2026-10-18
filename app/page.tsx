
export default function Home() {
  return (
    <main className="min-h-screen bg-slate-950 text-white flex flex-col items-center justify-center p-8">
      <h1 className="text-4xl font-bold mb-4">
        Podcast Voice Agent
      </h1>

      <p className="text-slate-300 text-center mb-8">
        Découvrez votre prochain podcast grâce à l'IA.
      </p>

      <button className="bg-violet-600 hover:bg-violet-500 px-6 py-3 rounded-full">
        🎙️ Parler à l'assistant
      </button>
    </main>
  );
}