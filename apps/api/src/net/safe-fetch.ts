import { lookup as dnsLookup } from 'node:dns';
import { BlockList, isIP, type LookupFunction } from 'node:net';
import { Agent, fetch } from 'undici';

/**
 * Descarga de URLs elegidas por el usuario (suscripción a un `.ics` externo). Como el servidor
 * hace la petición, hay que evitar que sirva de puente a la red interna (SSRF): solo HTTPS, solo
 * al puerto 443 y solo a direcciones públicas, comprobadas **al conectar** (así un DNS que
 * cambie de respuesta entre la comprobación y la conexión tampoco sirve), incluidas las
 * redirecciones.
 */

export class UnsafeUrlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UnsafeUrlError';
  }
}

const blocked = new BlockList();
for (const [network, prefix] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10], // CGNAT
  ['127.0.0.0', 8],
  ['169.254.0.0', 16], // enlace local (incluye los metadatos de la nube: 169.254.169.254)
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4], // multicast
  ['240.0.0.0', 4], // reservado (incluye 255.255.255.255)
] as const) {
  blocked.addSubnet(network, prefix, 'ipv4');
}
for (const [network, prefix] of [
  ['::', 128], // no especificada
  ['::1', 128], // loopback
  ['64:ff9b::', 96], // NAT64
  ['100::', 64], // descarte
  ['2001:db8::', 32], // documentación
  ['2002::', 16], // 6to4
  ['fc00::', 7], // ULA (privadas)
  ['fe80::', 10], // enlace local
  ['ff00::', 8], // multicast
] as const) {
  blocked.addSubnet(network, prefix, 'ipv6');
}

/**
 * Si `address` es una IPv6 «IPv4 mapeada» (`::ffff:a.b.c.d`, en cualquiera de sus formas de
 * escribirla), devuelve la IPv4 que contiene.
 *
 * No se puede resolver con una regla en la lista de bloqueo: Node comprueba las direcciones
 * IPv4 contra las reglas IPv6 mapeadas, así que `::ffff:0:0/96` bloquearía todo IPv4.
 */
function embeddedIpv4(address: string): string | null {
  // `URL` normaliza cualquier forma (`0:0:0:0:0:ffff:7f00:1`, mayúsculas…) a la más corta.
  let normalized: string;
  try {
    normalized = new URL(`http://[${address}]`).hostname.replace(/^\[|\]$/g, '');
  } catch {
    return null;
  }
  const dotted = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(normalized);
  if (dotted) return dotted[1]!;
  const hex = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(normalized);
  if (!hex) return null;
  const [hi, lo] = [parseInt(hex[1]!, 16), parseInt(hex[2]!, 16)];
  return `${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`;
}

/** ¿Es una dirección a la que el servidor no debe conectarse? */
export function isBlockedAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 0) return true; // no es una IP válida: por si acaso, se rechaza
  if (family === 6) {
    const ipv4 = embeddedIpv4(address);
    return ipv4 !== null ? isBlockedAddress(ipv4) : blocked.check(address, 'ipv6');
  }
  return blocked.check(address, 'ipv4');
}

/** Valida una URL de suscripción y la normaliza (`webcal://` pasa a `https://`). */
export function parseSubscriptionUrl(input: string): URL {
  let text = input.trim();
  if (/^webcals?:\/\//i.test(text)) text = text.replace(/^webcals?:/i, 'https:');

  let url: URL;
  try {
    url = new URL(text);
  } catch {
    throw new UnsafeUrlError('La URL no es válida');
  }
  if (url.protocol !== 'https:')
    throw new UnsafeUrlError('Solo se admiten URLs https:// (o webcal://)');
  if (url.username || url.password)
    throw new UnsafeUrlError('La URL no puede incluir usuario ni contraseña');
  if (url.port && url.port !== '443') throw new UnsafeUrlError('Solo se admite el puerto 443');

  // Los corchetes de una IPv6 literal no forman parte de la dirección.
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (isIP(host) !== 0 && isBlockedAddress(host)) {
    throw new UnsafeUrlError('La URL apunta a una dirección no pública');
  }
  if (
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host.endsWith('.local') ||
    host.endsWith('.internal')
  ) {
    throw new UnsafeUrlError('La URL apunta a una dirección no pública');
  }
  return url;
}

/** Resolución DNS que rechaza cualquier respuesta con una dirección no pública. */
const safeLookup: LookupFunction = (hostname, options, callback) => {
  dnsLookup(hostname, { ...options, all: true }, (err, addresses) => {
    if (err) return callback(err, '', 0);
    const list = Array.isArray(addresses) ? addresses : [];
    if (list.length === 0 || list.some((a) => isBlockedAddress(a.address))) {
      return callback(new UnsafeUrlError('La URL apunta a una dirección no pública'), '', 0);
    }
    if (options.all) return (callback as unknown as (e: null, a: typeof list) => void)(null, list);
    callback(null, list[0]!.address, list[0]!.family);
  });
};

const agent = new Agent({ connect: { lookup: safeLookup } });

export interface FetchTextOptions {
  maxBytes?: number;
  timeoutMs?: number;
  maxRedirects?: number;
}

/** Descarga un texto (UTF-8) de forma segura. Lanza `UnsafeUrlError` o un `Error` normal. */
export async function fetchText(
  input: string,
  { maxBytes = 5_000_000, timeoutMs = 15_000, maxRedirects = 3 }: FetchTextOptions = {},
): Promise<string> {
  let url = parseSubscriptionUrl(input);

  for (let hop = 0; hop <= maxRedirects; hop++) {
    const response = await fetch(url, {
      dispatcher: agent,
      redirect: 'manual',
      signal: AbortSignal.timeout(timeoutMs),
      headers: {
        accept: 'text/calendar, text/plain;q=0.8, */*;q=0.5',
        'user-agent': 'PersonalCalendar/1.0',
      },
    });

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location');
      await response.body?.cancel();
      if (!location) throw new Error('El servidor redirige sin indicar adónde');
      url = parseSubscriptionUrl(new URL(location, url).toString()); // cada salto se vuelve a validar
      continue;
    }
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error(`El servidor respondió ${response.status}`);
    }

    const declared = Number(response.headers.get('content-length') ?? 0);
    if (declared > maxBytes) {
      await response.body?.cancel();
      throw new Error('El fichero es demasiado grande');
    }
    const chunks: Uint8Array[] = [];
    let total = 0;
    for await (const chunk of response.body ?? []) {
      total += chunk.byteLength;
      if (total > maxBytes) throw new Error('El fichero es demasiado grande');
      chunks.push(chunk);
    }
    return new TextDecoder('utf-8').decode(Buffer.concat(chunks));
  }
  throw new Error('Demasiadas redirecciones');
}
