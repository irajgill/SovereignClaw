import { DocsLayout } from '@/components/Layout';
import { Md } from '@/components/Md';
import { loadDocMd } from '@/components/loadMd';

export const metadata = { title: 'Security' };

export default function Page(): JSX.Element {
  const md = loadDocMd('docs/security.md');
  return (
    <DocsLayout active="/security">
      <Md source={md} />
    </DocsLayout>
  );
}
