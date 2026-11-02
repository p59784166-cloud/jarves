import { isIP } from 'node:net';
import Bonjour from 'bonjour-service';

function isPrivateIPv4(address) {
  const octets = address.split('.').map(Number);
  return octets[0] === 10
    || (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31)
    || (octets[0] === 192 && octets[1] === 168)
    || (octets[0] === 169 && octets[1] === 254);
}

export function shouldAdvertiseLanHost(host) {
  const address = String(host || '').replace(/^\[|\]$/g, '').toLowerCase();
  if (address === '0.0.0.0' || address === '::') return true;
  if (isIP(address) === 4) return isPrivateIPv4(address);
  if (isIP(address) === 6) return address.startsWith('fc') || address.startsWith('fd') || address.startsWith('fe80:');
  return false;
}

export function startJarvesLanDiscovery(port, version, { createBonjour, logger = console } = {}) {
  let bonjour;
  let service;
  const reportError = error => logger.warn(`[JARVES] Descoberta Wi-Fi indisponível: ${error.message || error}`);
  try {
    bonjour = createBonjour ? createBonjour(reportError) : new Bonjour({}, reportError);
    service = bonjour.publish({
      name: 'JARVES AI',
      type: 'jarves',
      port,
      txt: { app: 'jarves-ai', version },
    });
    service.on('error', reportError);
  } catch (error) {
    reportError(error);
    bonjour?.destroy();
    return () => {};
  }
  return () => {
    service.stop(() => bonjour.destroy());
  };
}
