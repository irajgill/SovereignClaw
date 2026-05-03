import { DocsLayout } from '@/components/Layout';
import { Md } from '@/components/Md';
import { loadDocMd } from '@/components/loadMd';

export const metadata = { title: 'Benchmarks' };

export default function Page(): JSX.Element {
  const md = loadDocMd('docs/benchmarks.md');
  return (
    <DocsLayout active="/benchmarks">
      <Md source={md} />
    </DocsLayout>
  );
}
