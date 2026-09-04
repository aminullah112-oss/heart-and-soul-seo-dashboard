import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="py-20 text-center">
      <h1 className="text-lg font-semibold">Not found</h1>
      <p className="mt-2 text-sm text-paper-faint">That project or page does not exist.</p>
      <Link href="/" className="mt-4 inline-block text-sm text-accent hover:underline">Back to dashboard</Link>
    </div>
  );
}
