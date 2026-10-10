// Public files verified against the packaged beta.5 release.
// Both website languages share these installer URLs and checksums.
export const release = {
  version: '0.1.0-beta.5',
  status: 'published' as 'preparing' | 'published',
  repositoryUrl: 'https://github.com/jslynn777/md-duck' as string | null,
  sourceUrl: 'https://mdduck.com/downloads/MD-Duck-0.1.0-beta.5-Corresponding-Source.tar.gz' as string | null,
  artifacts: [
    {
      kind: 'mac-dmg',
      label: 'Mac DMG',
      platform: 'macOS 13+ · Apple Silicon arm64',
      url: 'https://mdduck.com/downloads/MD-Duck-0.1.0-beta.5-macOS-arm64.dmg',
      size: '148.3 MB',
      sha256: '2f17d7d131b7a87a57f89c082315ad42ccce208dd4732a76a1767daf33e07e91',
    },
    {
      kind: 'windows-setup',
      label: 'Windows Setup',
      platform: 'Windows 10+ · x64',
      url: 'https://mdduck.com/downloads/MD-Duck-0.1.0-beta.5-Windows-x64-Setup.exe',
      size: '131.7 MB',
      sha256: 'ffaed2426e1f41338a5ea25d20028f5a0457b72638efb530e2950801d7bd5468',
    },
  ] as { kind: 'mac-dmg' | 'windows-setup'; label: string; platform: string; url: string; size: string; sha256: string }[],
};
