// Both website languages share these release files and checksums.
// Keep preparing until both installers and corresponding source have passed release checks.
export const release = {
  version: '0.1.0-beta.7',
  status: 'published' as 'preparing' | 'published',
  repositoryUrl: 'https://github.com/jslynn777/md-duck' as string | null,
  sourceUrl: 'https://mdduck.com/downloads/MD-Duck-0.1.0-beta.7-Corresponding-Source.tar.gz' as string | null,
  checksumsUrl: 'https://mdduck.com/downloads/MD-Duck-0.1.0-beta.7-SHA256SUMS.txt' as string | null,
  artifacts: [
    {
      kind: 'mac-dmg',
      label: 'Mac DMG',
      platform: 'macOS 13+ · Apple Silicon arm64',
      url: 'https://mdduck.com/downloads/MD-Duck-0.1.0-beta.7-macOS-arm64.dmg',
      size: '141.5 MiB',
      sha256: 'dad340f2a2e56f30d7749543d6d656cab4c781afe01ae2109cd7b0c3420b1f87',
    },
    {
      kind: 'windows-setup',
      label: 'Windows Setup',
      platform: 'Windows 10+ · x64',
      url: 'https://mdduck.com/downloads/MD-Duck-0.1.0-beta.7-Windows-x64-Setup.exe',
      size: '125.6 MiB',
      sha256: '86cbf3ee3f93b9fc56a42356bf82402371679068a9e05f7a9d1e9c38a03fc8d0',
    },
  ] as { kind: 'mac-dmg' | 'windows-setup'; label: string; platform: string; url: string; size: string; sha256: string }[],
};
