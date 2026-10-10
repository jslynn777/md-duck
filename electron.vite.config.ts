import { resolve } from 'node:path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

const speechExternals = ['onnxruntime-node', 'onnxruntime-common']

export default defineConfig({
  main: {
    // These parsers are ESM-only; bundle them so main-process CJS receives usable plugins.
    plugins: [externalizeDepsPlugin({ exclude: ['unified', 'remark-parse', 'remark-gfm'] })],
    build: {
      rollupOptions: {
        external: speechExternals,
        input: {
          index: resolve('src/main/index.ts'),
          'kokoro-runtime': resolve('src/main/kokoro-runtime.ts'),
          'speech-worker': resolve('src/main/speech-worker.ts')
        }
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()]
  },
  renderer: {
    server: {
      port: 5273,
      strictPort: true
    },
    resolve: {
      alias: {
        '@shared': resolve('src/shared')
      }
    },
    plugins: [react()]
  }
})
