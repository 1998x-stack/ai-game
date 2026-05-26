import dynamic from 'next/dynamic';

const HomeContent = dynamic(() => import('./HomeContent'), { ssr: false });

export default HomeContent;
