// Both website languages share these release files and checksums.
// Keep preparing until both installers and corresponding source have passed release checks.
export const release = {
  version: '0.1.0-beta.7',
  status: 'preparing' as 'preparing' | 'published',
  repositoryUrl: 'https://github.com/jslynn777/md-duck' as string | null,
  sourceUrl: 'https://mdduck.com/downloads/MD-Duck-0.1.0-beta.7-Corresponding-Source.tar.gz' as string | null,
  checksumsUrl: 'https://mdduck.com/downloads/MD-Duck-0.1.0-beta.7-SHA256SUMS.txt' as string | null,
  artifacts: [
    {
      kind: 'mac-dmg',
      label: 'Mac DMG',
      platform: 'macOS 13+ · Apple Silicon arm64',
      url: 'https://mdduck.com/downloads/MD-Duck-0.1.0-beta.7-macOS-arm64.dmg',
      size: '',
      sha256: '',
    },
    {
      kind: 'windows-setup',
      label: 'Windows Setup',
      platform: 'Windows 10+ · x64',
      url: 'https://mdduck.com/downloads/MD-Duck-0.1.0-beta.7-Windows-x64-Setup.exe',
      size: '',
      sha256: '',
    },
  ] as { kind: 'mac-dmg' | 'windows-setup'; label: string; platform: string; url: string; size: string; sha256: string }[],
};
