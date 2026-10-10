// Add verified public URLs here when the first release is ready.
// Keeping them absent renders an honest preparation state instead of dead links.
export const release = {
  version: '0.1.0-beta.4',
  status: 'preparing' as 'preparing' | 'published',
  repositoryUrl: 'https://github.com/jslynn777/md-duck' as string | null,
  artifacts: [] as { label: string; platform: string; url: string; size: string; sha256: string }[],
};
