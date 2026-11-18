import type { ComponentType, ReactNode } from "react";

/**
 * Stand-in for next/dynamic. In these views it only lazy-loads the artboard
 * editors, which are not part of this export, so every component it makes
 * renders nothing. If you move these files into a Next.js app, delete this
 * shim and the "next/dynamic" alias: the real one takes over unchanged.
 */
type Loaded<P> = ComponentType<P> | { default: ComponentType<P> };

export default function dynamic<P = Record<string, unknown>>(
  _loader: () => Promise<Loaded<P>>,
  _opts?: { ssr?: boolean; loading?: () => ReactNode },
): ComponentType<P> {
  return function NotInExport(): null {
    return null;
  };
}
