import { DocsLayout } from '@/components/Layout';
import { Md } from '@/components/Md';
import { loadDocMd } from '@/components/loadMd';

export const metadata = { title: 'Reflection' };

export default function Page(): JSX.Element {
  const md = loadDocMd('packages/reflection/README.md');
  return (
    <DocsLayout active="/primitives/reflection">
      <Md source={md} />
    </DocsLayout>
  );
}
