export const getStaticPaths = async () => ({ paths: [{ params: { slug: 'one' } }], fallback: 'blocking' });
export const getStaticProps = async ({ params }) => ({ props: { body: `CONTENT:legacy:${params.slug}` }, revalidate: 60 });
export default function Legacy({ body }) { return <article>{body}</article>; }
