export function parseHubOrigin(value: string): string {
  const url = new URL(value);
  const loopback = ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname);
  if (!(url.protocol === 'https:' || (loopback && url.protocol === 'http:')) ||
    url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('Configure an HTTPS hub origin or a local loopback origin.');
  }
  return url.origin;
}
