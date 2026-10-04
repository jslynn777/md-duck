/// <reference types="vite/client" />
import type { DuckApi } from '../../preload/index'

declare global {
  interface Window {
    api: DuckApi
  }
}

export {}
