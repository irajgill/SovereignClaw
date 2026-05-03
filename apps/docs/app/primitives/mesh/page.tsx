import { DocsLayout } from '@/components/Layout';
import { Md } from '@/components/Md';
import { loadDocMd } from '@/components/loadMd';

export const metadata = { title: 'Mesh' };

export default function Page(): JSX.Element {
  const md = loadDocMd('packages/mesh/README.md');
  return (
    <DocsLayout active="/primitives/mesh">
      <Md source={md} />
    </DocsLayout>
  );
}
