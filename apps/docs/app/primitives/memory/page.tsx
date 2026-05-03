import { DocsLayout } from '@/components/Layout';
import { Md } from '@/components/Md';
import { loadDocMd } from '@/components/loadMd';

export const metadata = { title: 'Sovereign Memory' };

export default function Page(): JSX.Element {
  const md = loadDocMd('packages/memory/README.md');
  return (
    <DocsLayout active="/primitives/memory">
      <Md source={md} />
    </DocsLayout>
  );
}
