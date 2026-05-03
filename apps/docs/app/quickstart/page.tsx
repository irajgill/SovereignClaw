import { DocsLayout } from '@/components/Layout';
import { Md } from '@/components/Md';
import { loadDocMd } from '@/components/loadMd';

export const metadata = { title: 'Quickstart' };

export default function Page(): JSX.Element {
  const md = loadDocMd('docs/quickstart.md');
  return (
    <DocsLayout active="/quickstart">
      <Md source={md} />
    </DocsLayout>
  );
}
