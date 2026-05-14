/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_WORK_START_HOUR?: string;
  readonly VITE_WORK_END_HOUR?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
