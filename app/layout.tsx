import './globals.css';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'MVP Bilan Kiné',
  description: 'Application de génération de bilans kinés avec IA',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="fr">
      <body>{children}</body>
    </html>
  );
}
