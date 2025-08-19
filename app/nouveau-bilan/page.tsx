import dynamic from 'next/dynamic';
const Recorder = dynamic(() => import('@/components/RecorderMulti'), { ssr: false });

export default function NouveauBilan() {
  return (
    <main className="p-8 max-w-2xl">
      <h2 className="text-xl font-semibold">Nouveau bilan</h2>
      <Recorder />
    </main>
  );
}
