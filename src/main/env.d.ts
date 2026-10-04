/// <reference types="electron-vite/node" />

declare module '*.txt?raw' {
  const data: string
  export default data
}
