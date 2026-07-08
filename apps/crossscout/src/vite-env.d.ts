/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_URL?: string;
  readonly VITE_API_PORT?: string;
  readonly VITE_TOKEN_LOGO_URL_TEMPLATE?: string;
}
interface ImportMeta {
  readonly env: ImportMetaEnv;
}
