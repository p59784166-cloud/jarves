import { EventEmitter } from 'node:events';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shouldAdvertiseLanHost, startJarvesLanDiscovery } from '../../backend/services/lanDiscovery.mjs';

test('LAN discovery is advertised only on wildcard or private interfaces', () => {
  for (const host of ['0.0.0.0', '::', '10.0.0.2', '172.20.1.4', '192.168.1.8', '169.254.1.3', 'fd12::1', 'fe80::1']) {
    assert.equal(shouldAdvertiseLanHost(host), true, host);
  }
  for (const host of ['127.0.0.1', 'localhost', '8.8.8.8', '172.32.0.1', 'example.com', '']) {
    assert.equal(shouldAdvertiseLanHost(host), false, host);
  }
});

test('LAN discovery publishes the health endpoint port and unregisters on shutdown', () => {
  const service = new EventEmitter();
  let published;
  let destroyed = false;
  let unpublished = false;
  const stop = startJarvesLanDiscovery(3210, '2.3.4', {
    createBonjour: () => ({
      publish: options => {
        published = options;
        service.stop = callback => {
          unpublished = true;
          callback();
        };
        return service;
      },
      destroy: () => { destroyed = true; },
    }),
    logger: { warn: message => assert.fail(message) },
  });
  assert.deepEqual(published, {
    name: 'JARVES AI',
    type: 'jarves',
    port: 3210,
    txt: { app: 'jarves-ai', version: '2.3.4' },
  });
  stop();
  assert.equal(unpublished, true);
  assert.equal(destroyed, true);
});

test('LAN discovery startup errors are reported without preventing the server from running', () => {
  const errors = [];
  const stop = startJarvesLanDiscovery(3000, '2.3.4', {
    createBonjour: () => { throw new Error('multicast unavailable'); },
    logger: { warn: message => errors.push(message) },
  });
  stop();
  assert.deepEqual(errors, ['[JARVES] Descoberta Wi-Fi indisponível: multicast unavailable']);
});
