import { DocsLayout } from '@/components/Layout';
import { Md } from '@/components/Md';
import { loadDocMd } from '@/components/loadMd';

export const metadata = { title: 'Streaming' };

export default function Page(): JSX.Element {
  const md = loadDocMd('docs/streaming.md');
  return (
    <DocsLayout active="/primitives/streaming">
      <Md source={md} />
    </DocsLayout>
  );
}
