import { describe, expect, it } from 'vitest';
import { UnsafeUrlError, fetchText, isBlockedAddress, parseSubscriptionUrl } from './safe-fetch.ts';

describe('isBlockedAddress', () => {
  it.each([
    '0.0.0.0',
    '10.1.2.3',
    '100.64.0.1',
    '127.0.0.1',
    '127.255.255.254',
    '169.254.169.254', // metadatos de la nube
    '172.16.0.1',
    '172.31.255.255',
    '192.168.1.1',
    '198.18.0.1',
    '224.0.0.1',
    '240.0.0.1',
    '255.255.255.255',
    '::',
    '::1',
    '::ffff:127.0.0.1',
    '::ffff:10.0.0.1',
    '::ffff:169.254.169.254',
    '::ffff:7f00:1', // 127.0.0.1 en hexadecimal
    '::FFFF:7F00:0001',
    '0:0:0:0:0:ffff:7f00:1', // forma larga
    '::ffff:0a00:0001', // 10.0.0.1
    '::ffff:a9fe:a9fe', // 169.254.169.254
    'fc00::1',
    'fd12:3456::1',
    'fe80::1',
    'ff02::1',
    '64:ff9b::7f00:1',
    '2002:7f00:1::1',
    'no-es-una-ip',
    '',
  ])('bloquea %s', (address) => {
    expect(isBlockedAddress(address)).toBe(true);
  });

  it.each([
    '8.8.8.8',
    '1.1.1.1',
    '142.250.184.14',
    '172.15.255.255', // justo fuera de 172.16/12
    '172.32.0.1',
    '100.63.255.255', // justo fuera de CGNAT
    '2a00:1450:4003:80f::200e',
    '2606:4700:4700::1111',
    '::ffff:8.8.8.8',
    '::ffff:808:808', // 8.8.8.8 en hexadecimal
  ])('permite %s', (address) => {
    expect(isBlockedAddress(address)).toBe(false);
  });
});

describe('parseSubscriptionUrl', () => {
  it('acepta https y convierte webcal:// y webcals://', () => {
    expect(parseSubscriptionUrl('https://example.com/cal.ics').hostname).toBe('example.com');
    expect(parseSubscriptionUrl('webcal://example.com/cal.ics').protocol).toBe('https:');
    expect(parseSubscriptionUrl('WEBCALS://example.com/cal.ics').protocol).toBe('https:');
    expect(parseSubscriptionUrl('  https://example.com:443/cal.ics ').port).toBe('');
  });

  it.each([
    ['http://example.com/cal.ics', /https/],
    ['ftp://example.com/cal.ics', /https/],
    ['file:///etc/passwd', /https/],
    ['javascript:alert(1)', /https/],
    ['no es una url', /no es válida/],
    ['https://user:pass@example.com/cal.ics', /usuario/],
    ['https://example.com:8443/cal.ics', /puerto/],
    ['https://127.0.0.1/cal.ics', /no pública/],
    ['https://10.0.0.5/cal.ics', /no pública/],
    ['https://169.254.169.254/latest/meta-data/', /no pública/],
    ['https://[::1]/cal.ics', /no pública/],
    ['https://[::ffff:7f00:1]/cal.ics', /no pública/],
    ['https://localhost/cal.ics', /no pública/],
    ['https://api.localhost/cal.ics', /no pública/],
    ['https://impresora.local/cal.ics', /no pública/],
    ['https://db.internal/cal.ics', /no pública/],
  ])('rechaza %s', (url, message) => {
    expect(() => parseSubscriptionUrl(url)).toThrow(UnsafeUrlError);
    expect(() => parseSubscriptionUrl(url)).toThrow(message);
  });

  it('rechaza la forma decimal y hexadecimal de 127.0.0.1 (URL las normaliza)', () => {
    expect(() => parseSubscriptionUrl('https://2130706433/cal.ics')).toThrow(/no pública/);
    expect(() => parseSubscriptionUrl('https://0x7f000001/cal.ics')).toThrow(/no pública/);
    expect(() => parseSubscriptionUrl('https://0177.0.0.1/cal.ics')).toThrow(/no pública/);
  });
});

describe('fetchText', () => {
  it('no llega a conectar con direcciones privadas ni con nombres que resuelven a ellas', async () => {
    await expect(fetchText('https://127.0.0.1/x')).rejects.toThrow(UnsafeUrlError);
    await expect(fetchText('https://localhost/x')).rejects.toThrow(UnsafeUrlError);
    await expect(fetchText('http://example.com/x')).rejects.toThrow(UnsafeUrlError);
  });
});
