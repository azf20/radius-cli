import { notFound } from 'next/navigation';

export const revalidate = 60; // ISR
const KNOWN = ['hello', 'world'];
export function generateStaticParams() { return KNOWN.map((slug) => ({ slug })); }

export default async function Article({ params }) {
  const { slug } = await params;
  if (!KNOWN.includes(slug)) notFound();
  return <article>CONTENT:article:{slug}</article>;
}
