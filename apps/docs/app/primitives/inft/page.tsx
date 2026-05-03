import { DocsLayout } from '@/components/Layout';
import { Md } from '@/components/Md';
import { loadDocMd } from '@/components/loadMd';

export const metadata = { title: 'iNFT Lifecycle' };

export default function Page(): JSX.Element {
  const md = loadDocMd('packages/inft/README.md');
  return (
    <DocsLayout active="/primitives/inft">
      <Md source={md} />
    </DocsLayout>
  );
}
