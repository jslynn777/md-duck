// Public files verified against the packaged beta.6 release.
// Both website languages share these installer URLs and checksums.
export const release = {
  version: '0.1.0-beta.6',
  status: 'published' as 'preparing' | 'published',
  repositoryUrl: 'https://github.com/jslynn777/md-duck' as string | null,
  sourceUrl: 'https://mdduck.com/downloads/MD-Duck-0.1.0-beta.6-Corresponding-Source.tar.gz' as string | null,
  artifacts: [
    {
      kind: 'mac-dmg',
      label: 'Mac DMG',
      platform: 'macOS 13+ · Apple Silicon arm64',
      url: 'https://mdduck.com/downloads/MD-Duck-0.1.0-beta.6-macOS-arm64.dmg',
      size: '148.3 MB',
      sha256: '2b332ba80a8d0c3eccba4d50881122ef0781790c78e202cbe0c9ec8aab35accd',
    },
    {
      kind: 'windows-setup',
      label: 'Windows Setup',
      platform: 'Windows 10+ · x64',
      url: 'https://mdduck.com/downloads/MD-Duck-0.1.0-beta.6-Windows-x64-Setup.exe',
      size: '131.7 MB',
      sha256: 'b3afec88ecda2298cdd4c66150e2350cccc9403abff1791e912da5ebadccec05',
    },
  ] as { kind: 'mac-dmg' | 'windows-setup'; label: string; platform: string; url: string; size: string; sha256: string }[],
};
