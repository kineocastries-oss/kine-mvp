import type { Metadata } from "next";
import "./globals.css"; // si tu n'as pas de fichier globals.css dans Application/, supprime cette ligne

export const metadata: Metadata = {
  title: "Kiné MVP",
  description: "Application kiné",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr">
      <body>{children}</body>
    </html>
  );
}
