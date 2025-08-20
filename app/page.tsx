import Link from "next/link";

export default function Home() {
  return (
    <main style={{ padding: "2rem" }}>
      <h1>Bienvenue sur Kine MVP 🚀</h1>
      <Link href="/nouveau-bilan">
        <button>Aller vers Nouveau Bilan</button>
      </Link>
    </main>
  );
}
