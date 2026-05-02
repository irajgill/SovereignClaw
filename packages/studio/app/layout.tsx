import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import './globals.css';
import 'reactflow/dist/style.css';

export const metadata: Metadata = {
  title: 'ClawStudio',
  description: 'Drag-and-drop visual builder for SovereignClaw agents, meshes, and iNFTs on 0G.',
};

export default function RootLayout({ children }: { children: ReactNode }): JSX.Element {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
