// Both website languages share these verified release files and checksums.
// Deployment still requires full public download verification before activation.
export const release = {
  "version": "0.1.0-beta.10",
  "status": "published",
  "repositoryUrl": "https://github.com/jslynn777/md-duck",
  "sourceUrl": "https://mdduck.com/downloads/MD-Duck-0.1.0-beta.10-Corresponding-Source.tar.gz",
  "checksumsUrl": "https://mdduck.com/downloads/MD-Duck-0.1.0-beta.10-SHA256SUMS.txt",
  "artifacts": [
    {
      "kind": "mac-dmg",
      "label": "Mac DMG",
      "platform": "macOS 13+ · Apple Silicon arm64",
      "url": "https://mdduck.com/downloads/MD-Duck-0.1.0-beta.10-macOS-arm64.dmg",
      "size": "141.7 MiB",
      "sha256": "b9da2d5f179fdef67cce4426e113da9d949c4efa941f3c56e004328146c49054"
    },
    {
      "kind": "windows-setup",
      "label": "Windows Setup",
      "platform": "Windows 10+ · x64",
      "url": "https://mdduck.com/downloads/MD-Duck-0.1.0-beta.10-Windows-x64-Setup.exe",
      "size": "125.8 MiB",
      "sha256": "5f20bf321f0ac3c005067a9ab846cd35e95288f0b2ba980d917ddf26a5fab640"
    }
  ]
} as {
  version: string;
  status: 'preparing' | 'published';
  repositoryUrl: string | null;
  sourceUrl: string | null;
  checksumsUrl: string | null;
  artifacts: { kind: 'mac-dmg' | 'windows-setup'; label: string; platform: string; url: string; size: string; sha256: string }[];
};
