import { EventEmitter } from 'events';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import Logger from '../../../lib/Logger';
import LndClient from '../../../lib/lightning/LndClient';
import {
  GetInfoResponse,
  Invoice_InvoiceState,
} from '../../../lib/proto/lnd/rpc';

describe('LndClient', () => {
  const dir = mkdtempSync(join(tmpdir(), 'lndclient-'));
  const certpath = join(dir, 'tls.cert');
  const macaroonpath = join(dir, 'admin.macaroon');
  writeFileSync(certpath, 'not a certificate; never connected');
  writeFileSync(macaroonpath, Buffer.alloc(32));

  afterAll(() => {
    rmSync(dir, { recursive: true });
  });

  test('should report the feature bits of getinfo', async () => {
    // Through the wire format, as lnd's answer arrives
    const response = GetInfoResponse.decode(
      GetInfoResponse.encode(
        GetInfoResponse.fromPartial({
          version: '0.21.3-beta-blake2b.17',
          identityPubkey: '03cd',
          features: {
            0: { name: 'data-loss-protect', isRequired: true, isKnown: true },
            512: { name: 'blake2b', isRequired: true, isKnown: true },
            515: { name: 'unified-sigs', isRequired: false, isKnown: true },
          },
        }),
      ).finish(),
    );

    const client = new LndClient(
      Logger.disabledLogger,
      'BTC',
      { host: '127.0.0.1', port: 10009, certpath, macaroonpath } as any,
      {} as any,
      undefined as any,
    );
    (client as any).unaryLightningCall = jest.fn().mockResolvedValue(response);

    const info = await client.getInfo();
    expect(info.features?.sort((a, b) => a - b)).toEqual([0, 512, 515]);
    expect(info.version).toEqual('0.21.3-beta-blake2b.17');
  });

  test('subscribes again, after a reconnection, to the invoices still waited on', async () => {
    const client = new LndClient(
      Logger.disabledLogger,
      'BTC',
      { host: '127.0.0.1', port: 10009, certpath, macaroonpath } as any,
      {} as any,
      undefined as any,
    );
    const streams: EventEmitter[] = [];
    const subscribe = jest.fn(() => {
      const stream = Object.assign(new EventEmitter(), { destroy: jest.fn() });
      streams.push(stream);
      return stream;
    });
    (client as any).invoices = { subscribeSingleInvoice: subscribe };
    (client as any).getInfo = jest.fn().mockResolvedValue({ pubkey: '03cd' });
    (client as any).subscribePeerEvents = jest.fn();
    (client as any).subscribeChannelEvents = jest.fn();

    const waited = Buffer.alloc(32, 1);
    const accepted = Buffer.alloc(32, 2);
    const cancelled = Buffer.alloc(32, 3);
    client.subscribeSingleInvoice(waited);
    client.subscribeSingleInvoice(accepted);
    client.subscribeSingleInvoice(cancelled);

    // lnd restarts: the stream of the one waited on ends without an outcome
    streams[0].emit('end');
    streams[1].emit('data', {
      state: Invoice_InvoiceState.ACCEPTED,
      htlcs: [],
      paymentRequest: 'lnbc-accepted',
    });
    streams[2].emit('data', { state: Invoice_InvoiceState.CANCELED });

    await (client as any).reconnect();
    expect(subscribe).toHaveBeenCalledTimes(4);
    const again = (subscribe.mock.calls as any[][])[3][0];
    expect(Buffer.from(again.rHash)).toEqual(waited);

    // A second reconnection subscribes it once more, never twice at a time
    await (client as any).reconnect();
    expect(subscribe).toHaveBeenCalledTimes(5);
    expect((streams[3] as any).destroy).toHaveBeenCalled();
  });
});
