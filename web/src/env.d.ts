/// <reference types="vite/client" />

declare const __APP_VERSION__: string;

interface ImportMetaEnv {
  /** Supabase project URL. Unset: the app runs local-only, without sign-in or AI coaching. */
  readonly VITE_SUPABASE_URL?: string;
  /** Supabase anon (publishable) key. Public by design; row-level security protects the data. */
  readonly VITE_SUPABASE_ANON_KEY?: string;
}
