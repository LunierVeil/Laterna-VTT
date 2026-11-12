// Real LAN HTTP: no security flags or crypto mocks. Reuse full UI/ownership/preview regressions.
import { networkInterfaces } from 'node:os';
const address = Object.values(networkInterfaces()).flat().find(a => a?.family === 'IPv4' && !a.internal)?.address;
if (!address) throw Error('A non-loopback IPv4 interface is required');
process.env.LATERNA_HTTP_HOST = address;
await import('./catalog.test.mjs');
await import('./tokens.test.mjs');
