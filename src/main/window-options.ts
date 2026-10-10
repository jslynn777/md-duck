import type { BrowserWindowConstructorOptions } from 'electron'

export function windowChrome(platform: NodeJS.Platform): BrowserWindowConstructorOptions {
  return platform === 'darwin'
    ? { titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 18, y: 18 } }
    : { titleBarStyle: 'default' }
}
