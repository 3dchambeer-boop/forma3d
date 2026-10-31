// =====================================================================
// 404 Not Found
// =====================================================================

import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-background text-foreground p-6">
      <div className="text-center max-w-md">
        <div className="text-7xl font-bold font-mono bg-gradient-to-br from-cyan-glow to-violet-glow bg-clip-text text-transparent mb-4">
          404
        </div>
        <h1 className="text-xl font-semibold mb-2">Page not found</h1>
        <p className="text-sm text-muted-foreground mb-6">
          The page you are looking for doesn&apos;t exist or has been moved.
        </p>
        <Link
          href="/"
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-gradient-to-r from-cyan-glow to-violet-glow text-background hover:opacity-90 transition"
        >
          Back to home
        </Link>
      </div>
    </div>
  );
}
