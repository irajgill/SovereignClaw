import { DocsLayout } from '@/components/Layout';
import { Md } from '@/components/Md';
import { loadDocMd } from '@/components/loadMd';

export const metadata = { title: 'Architecture' };

export default function Page(): JSX.Element {
  const md = loadDocMd('docs/architecture.md');
  return (
    <DocsLayout active="/architecture">
      <Md source={md} />
    </DocsLayout>
  );
}
