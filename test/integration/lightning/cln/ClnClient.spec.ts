import { sha256 } from '@noble/hashes/sha2.js';
import { randomBytes } from 'crypto';
import { getHexString, getUnixTime } from '../../../../lib/Utils';
import Errors from '../../../../lib/lightning/Errors';
import { InvoiceFeature } from '../../../../lib/lightning/LightningClient';
import ClnClient from '../../../../lib/lightning/cln/ClnClient';
import * as noderpc from '../../../../lib/proto/cln/node';
import * as holdrpc from '../../../../lib/proto/hold/hold';
import Sidecar from '../../../../lib/sidecar/Sidecar';
import { wait } from '../../../Utils';
import {
  bitcoinClient,
  bitcoinLndClient,
  clnClient,
  waitForClnChainSync,
} from '../../Nodes';
import { sidecar, startSidecar } from '../../sidecar/Utils';

describe('ClnClient', () => {
  beforeAll(async () => {
    await startSidecar();

    await bitcoinClient.generate(1);
    await bitcoinLndClient.connect(false);
    await sidecar.connect(
      { on: jest.fn(), removeAllListeners: jest.fn() } as any,
      {} as any,
      false,
    );
  });

  afterAll(async () => {
    await Sidecar.stop();

    clnClient.removeAllListeners();
    clnClient.disconnect();
    bitcoinLndClient.disconnect();
  });

  test('should init', async () => {
    expect(clnClient.isConnected()).toEqual(false);
    await clnClient.connect();
    expect(clnClient.isConnected()).toEqual(true);

    clnClient.subscribeTrackHoldInvoices();
  });

  test('should parse node URIs in getinfo', async () => {
    const { uris } = await clnClient.getInfo();
    expect(uris).toHaveLength(0);
  });

  describe('addHoldInvoice', () => {
    test('should generate hold invoices', async () => {
      const invoice = await clnClient.addHoldInvoice(10_000, randomBytes(32));
      expect(invoice.startsWith('lnbcrt')).toBeTruthy();
    });

    test.each`
      expiry
      ${60}
      ${1200}
      ${3600}
      ${43200}
    `('should create invoices with expiry $expiry', async ({ expiry }) => {
      const invoice = await clnClient.addHoldInvoice(
        10_000,
        randomBytes(32),
        undefined,
        expiry,
      );
      const dec = await sidecar.decodeInvoiceOrOffer(invoice);
      expect(dec.isExpired).toEqual(false);
      expect(getUnixTime() + expiry - dec.expiryTimestamp).toBeLessThanOrEqual(
        5,
      );
    });

    test('should create invoices with description hash', async () => {
      const descriptionHash = randomBytes(32);
      const invoice = await clnClient.addHoldInvoice(
        1,
        randomBytes(32),
        undefined,
        undefined,
        undefined,
        descriptionHash,
      );
      const dec = await sidecar.decodeInvoiceOrOffer(invoice);
      expect(getHexString(dec.descriptionHash!)).toEqual(
        getHexString(descriptionHash),
      );
    });

    test('should round-trip memos with non-ASCII characters', async () => {
      const memo = 'café 🚀 ナンセンス 1杯 ₿';
      const invoice = await clnClient.addHoldInvoice(
        1,
        randomBytes(32),
        undefined,
        undefined,
        memo,
      );
      const dec = await sidecar.decodeInvoiceOrOffer(invoice);
      expect(dec.description).toEqual(memo);
    });

    test('should create invoices with memos of the maximal length of 639 bytes', async () => {
      const memo = '₿'.repeat(213);
      const invoice = await clnClient.addHoldInvoice(
        1,
        randomBytes(32),
        undefined,
        undefined,
        memo,
      );
      const dec = await sidecar.decodeInvoiceOrOffer(invoice);
      expect(dec.description).toEqual(memo);
    });

    test('should prefer description hash over memo', async () => {
      const descriptionHash = randomBytes(32);
      const invoice = await clnClient.addHoldInvoice(
        1,
        randomBytes(32),
        undefined,
        undefined,
        'test',
        descriptionHash,
      );
      const dec = await sidecar.decodeInvoiceOrOffer(invoice);
      expect(dec.description).toBeUndefined();
      expect(getHexString(dec.descriptionHash!)).toEqual(
        getHexString(descriptionHash),
      );
    });
  });

  describe('sendPayment', () => {
    test('should send payments', async () => {
      const invoice = await bitcoinLndClient.addInvoice(100);

      const res = await clnClient.sendPayment(invoice.paymentRequest);

      expect(res.feeMsat).toEqual(0);
      expect(getHexString(Buffer.from(sha256(res.preimage)))).toEqual(
        getHexString(invoice.rHash),
      );
    });

    test('should handle payment failures', async () => {
      const invoice = await bitcoinLndClient.addInvoice(100);
      await bitcoinLndClient.cancelHoldInvoice(invoice.rHash);

      await expect(
        clnClient.sendPayment(invoice.paymentRequest),
      ).rejects.toEqual(
        "Destination said it doesn't know invoice: incorrect_or_unknown_payment_details",
      );
    });
  });

  test('should fail settle for invalid states', async () => {
    await expect(clnClient.settleHoldInvoice(randomBytes(32))).rejects.toEqual(
      expect.anything(),
    );

    const preimageHash = randomBytes(32);
    await clnClient.addHoldInvoice(10_000, preimageHash);
    await expect(clnClient.settleHoldInvoice(preimageHash)).rejects.toEqual(
      expect.anything(),
    );
  });

  test('should query routes', async () => {
    const { pubkey } = await bitcoinLndClient.getInfo();

    let routes = await clnClient.queryRoutes(pubkey, 10_000);
    expect(routes.length).toEqual(1);
    expect(routes[0].ctlv).toEqual(9);
    expect(routes[0].feesMsat).toEqual(0);

    routes = await clnClient.queryRoutes(pubkey, 10_000, undefined, 89);
    expect(routes.length).toEqual(1);
    expect(routes[0].ctlv).toEqual(89);
    expect(routes[0].feesMsat).toEqual(0);

    await expect(clnClient.queryRoutes(pubkey, 10_000, 1)).rejects.toEqual(
      Errors.NO_ROUTE(),
    );
  });

  test('should detect pending payments', async () => {
    const preimage = randomBytes(32);
    const invoice = await bitcoinLndClient.addHoldInvoice(
      10_000,
      Buffer.from(sha256(preimage)),
    );

    bitcoinLndClient.subscribeSingleInvoice(Buffer.from(sha256(preimage)));
    const acceptedPromise = new Promise((resolve) => {
      bitcoinLndClient.on('htlc.accepted', resolve);
    });

    await waitForClnChainSync();

    const payPromise = clnClient.sendPayment(invoice);
    await acceptedPromise;

    await expect(clnClient.sendPayment(invoice)).rejects.toEqual(
      'payment already pending',
    );

    await bitcoinLndClient.settleHoldInvoice(preimage);
    expect((await payPromise).preimage).toEqual(preimage);
  });

  test('should detect successful payments', async () => {
    const invoice = (await bitcoinLndClient.addInvoice(10_000)).paymentRequest;

    const payRes = await clnClient.sendPayment(invoice);
    expect(await clnClient.checkPayStatus(invoice)).toEqual(payRes);
  });

  test('should not throw when getting pay status of BOLT12 invoices', async () => {
    const offerReq = noderpc.OfferRequest.create({
      amount: 'any',
    });

    const offer: noderpc.OfferResponse = await clnClient['unaryNodeCall'](
      'offer',
      offerReq,
    );

    const invoiceReq = noderpc.FetchinvoiceRequest.create({
      offer: offer.bolt12,
      amountMsat: {
        msat: '1000',
      },
    });

    const invoice: noderpc.FetchinvoiceResponse = await clnClient[
      'unaryNodeCall'
    ]('fetchInvoice', invoiceReq);

    await expect(
      clnClient.checkPayStatus(invoice.invoice),
    ).resolves.toBeUndefined();

    await clnClient.sendPayment(invoice.invoice);
    await expect(
      clnClient.checkPayStatus(invoice.invoice),
    ).resolves.not.toBeUndefined();
  });

  test('should emit events for invoice acceptance and settlement', async () => {
    const preimage = randomBytes(32);
    const preimageHash = Buffer.from(sha256(preimage));
    const invoice = await clnClient.addHoldInvoice(10, preimageHash);

    const acceptedPromise = new Promise<void>((resolve) => {
      clnClient.on('htlc.accepted', (eventInvoice: string) => {
        expect(eventInvoice).toEqual(invoice);
        resolve();
      });
    });

    const settledPromise = new Promise<void>((resolve) => {
      clnClient.on('invoice.settled', (eventInvoice: string) => {
        expect(eventInvoice).toEqual(invoice);
        resolve();
      });
    });

    const paymentPromise = bitcoinLndClient.sendPayment(invoice);
    await acceptedPromise;

    await clnClient.settleHoldInvoice(preimage);
    await paymentPromise;
    await settledPromise;
  });

  test('should inject hold invoices', async () => {
    const invoiceReq = noderpc.InvoiceRequest.create({
      label: getHexString(randomBytes(32)),
      amountMsat: {
        amount: {
          msat: '10000',
        },
      },
    });

    const invoiceRes = await clnClient['unaryNodeCall']<
      noderpc.InvoiceRequest,
      noderpc.InvoiceResponse
    >('invoice', invoiceReq);
    const minCltv = 123;
    await clnClient.injectHoldInvoice(invoiceRes.bolt11, minCltv);

    const decoded = await clnClient.decodeInvoice(invoiceRes.bolt11);
    const listReq = holdrpc.ListRequest.create({
      paymentHash: decoded.paymentHash,
    });

    const injectedInvoice = (
      await clnClient['unaryHoldCall']<
        holdrpc.ListRequest,
        holdrpc.ListResponse
      >('list', listReq)
    ).invoices;

    expect(injectedInvoice.length).toEqual(1);
    expect(injectedInvoice[0].minCltvExpiry).toEqual(minCltv.toString());
  });

  describe('decodeInvoice', () => {
    test.each`
      name                | data
      ${'BOLT11 invoice'} | ${'lnbcrt10n1p40v2mzsp5e3j4xq0axnkcz9a0mh29357wuc54gjw5wl3z52yxjrxz9rg595rspp5nm60qc3x6u2tyz0y7xw2yn9zd78l82g4erfusv40xywqu0fpdkksdqqxqyjw5qcqpjrzjqgy2deh437gtz5kvucrxsjs8tukalwhmpzjy8fzrhgwuxnt35uaewqqq5yqqqqgqqqqqqqlgqqqqqqgqrq9r8yqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqpqysgqpdxft7pp73ylyanvlrsa7pksr9hz5ay5u4qu4ey2s7nuqfq4hwtzshmf5z2e5g8ecyw67k0esa7lvqnnrjtkgkcyy8dg6j90wdnj79sqyh78ln'}
      ${'BOLT12 offer'}   | ${'lno1qgsqvgnwgcg35z6ee2h3yczraddm72xrfua9uve2rlrm9deu7xyfzrc2qanxj7r5w4ex2rzpqyqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqzcss93gzmduz5zr8fmtzp5t0angfgnf95mj32aymhwwlwx70fez3xshp'}
      ${'BOLT12 invoice'} | ${'lni1qqgqu4x3nhjh44a3yfytd9kvv39pwq3qqc3xu3s3rg94nj40zfsy866mhu5vxne6tcej5878k2mneuvgjy8s5pmxd9u8gatjv5xyzqgqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq93pqtzs9kmc9gyxwnkkyrgklmxsj3xjtfh9z46fhwua7udu7nj9zdpwz5pqqc3xu3s3rg94nj40zfsy866mhu5vxne6tcej5878k2mneuvgjy84yq4yzp2yzqgqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqkppqvmmustv8mw22she3yd5mu6fyjr37wvflmusp8q2w6v298txflmu3gycqtzs9kmc9gyxwnkkyrgklmxsj3xjtfh9z46fhwua7udu7nj9zdpwzqk9v24txvcznwt4khsryj4lfw3675at8aqm8u7fc7s4gu0xdrk5mgqs89uu78plu2zvenzeyrlrrc7yuc2n3t7a6x5mfarql6ejkscxycvvqqepja3rqwss5psk6upe3y203x47evh0kmvhkwer9jf2ngll7c75zssp6qxt7kgyn8pktcdp3m8c8kskz3d2y8qqqqqqqqqqqqqqqysqqqqqqqqqqqqp6f9jm7k9yqqqqqq2gpr27c5g92pqsquyal5jud8tgqvpvw8m7j50a5v6yulkg39uu38yt4yqljuhlha65q4yzzhyzqgqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqgqqpvppqtzs9kmc9gyxwnkkyrgklmxsj3xjtfh9z46fhwua7udu7nj9zdpwruzqwvk58357axyz65uc0avaljg3rgufl8vj9ju4cqjrspdnfxtgln7pncygj7nqd078g0yz0pqtzrwykyzn9etmsntkuztpcgl3kf0md4q'}
    `('should get destination of $name', async ({ data }) => {
      // Made by a Core Lightning node on the BLAKE2b regtest (regtest-blake2b):
      // its invoices and offers set option_blake2b (512)
      const dec = await clnClient.decodeInvoice(data);
      expect(dec.destination).toEqual(
        '02c502db782a08674ed620d16fecd0944d25a6e515749bbb9df71bcf4e451342e1',
      );
    });

    test('should decode invoices', async () => {
      const mppInvoice =
        'lnbcrt1m1pjdlsrqpp5jde4zp60f39rppkpq3fear0pqptqwpjp63m0v749sffmf0s3dxuqdqqcqzzsxqyz5vqsp5m6qqudhd3z8t2pqrpjekpfn44744zmkp3upafe9u46hx2n8lvr6q9qyyssqlvzl9f5a06m342mdvyl8vfltqt8arqusll7ce792pwyakcp3c0qsgaezprew08ejc2yshverayqjuhz5gtg09n6ffu9pll08n8y3vsqpqpt9f5';
      let res = await clnClient.decodeInvoice(mppInvoice);
      expect(res.features.size).toEqual(1);
      expect(res.features.has(InvoiceFeature.MPP)).toBeTruthy();

      const routingHintsInvoice =
        'lnbc1pjwp5lvpp59kx6l0etkcdzfr33u4e6z2u6thty263w74svcfdgsh0k3svqkdxscqpjsp5emlemc9ehxkc9etwlue29arap0v23n2tfmj2nmu9l8lemn2ta8ls9q7sqqqqqqqqqqqqqqqqqqqsqqqqqysgqdqqmqz9gxqyjw5qrzjqwryaup9lh50kkranzgcdnn2fgvx390wgj5jd07rwr3vxeje0glclll3zu949263tyqqqqlgqqqqqeqqjqqjmswn6zzycvcecrkwlg5cnrpxqr3v46dpsn20fm5g8x8hm8zqqx24t5szrelp6sxs5akftcd2cra8s5vnc4d4k9vkulzr5mwjqz2mqpfvcsyr';
      res = await clnClient.decodeInvoice(routingHintsInvoice);
      expect(res.routingHints.length).toEqual(1);
      expect(res.routingHints[0].length).toEqual(1);
      expect(res.routingHints[0][0]).toEqual({
        nodeId:
          '03864ef025fde8fb587d989186ce6a4a186895ee44a926bfc370e2c366597a3f8f',
        cltvExpiryDelta: 144,
        feeBaseMsat: 1000,
        chanId: '18442547286457930073',
        feeProportionalMillionths: 100,
      });

      // Throw for AMP invoices
      await expect(
        clnClient.decodeInvoice(
          'lnbcrt1m1pjdl0y5pp5f4ljuqc3hphgadf0nqyw8hxn6klcupntynpggm487dcx2slhhndsdqqcqzzsxq9z0rgqsp59fkq9py9rzes0n4gyvwqktk6020cjzjt6lydkd2casxn4gwq00lq9q8pqqqssq4c42h37htf2w873jthvx9n8zfunl07fjvkv739xggy9uvht95crk08qdwqd59hffxryjfgcylkqlzx3hf8q2tkvnjnlkqqn768k5e5gprl27z9',
        ),
      ).rejects.toEqual(expect.anything());
    });
  });

  describe('checkPayStatus', () => {
    test('should throw when all attempts failed', async () => {
      const invoice = await bitcoinLndClient.addInvoice(10_000);
      await bitcoinLndClient.cancelHoldInvoice(invoice.rHash);

      await expect(
        clnClient.sendPayment(invoice.paymentRequest),
      ).rejects.toEqual(expect.anything());

      await expect(
        clnClient.checkPayStatus(invoice.paymentRequest),
      ).rejects.toEqual(ClnClient.paymentAllAttemptsFailed);
    });

    test('should not throw when no attempts have been made', async () => {
      const invoice = await bitcoinLndClient.addInvoice(10_000);
      await expect(
        clnClient.checkPayStatus(invoice.paymentRequest),
      ).resolves.toBeUndefined();
    });
  });

  test('should subscribe to single invoices', async () => {
    expect.assertions(4);

    const preimage = randomBytes(32);
    const preimageHash = Buffer.from(sha256(preimage));

    const invoice = await clnClient.addHoldInvoice(1_000, preimageHash);

    clnClient.disconnect();

    const acceptedPromise = new Promise<void>((resolve) => {
      clnClient.once('htlc.accepted', (acceptedInvoice) => {
        expect(acceptedInvoice).toEqual(invoice);
        resolve();
      });
    });

    const payPromise = bitcoinLndClient.sendPayment(invoice);
    await wait(1_000);

    clnClient.subscribeSingleInvoice(preimageHash);
    expect(clnClient['holdInvoicesToSubscribe'].size).toEqual(1);
    expect(
      clnClient['holdInvoicesToSubscribe'].has(getHexString(preimageHash)),
    ).toEqual(true);

    await clnClient.connect();
    clnClient.subscribeTrackHoldInvoices();

    expect(clnClient['holdInvoicesToSubscribe'].size).toEqual(0);

    await acceptedPromise;
    await clnClient.settleHoldInvoice(preimage);
    await payPromise;
  });

  test('should get routing hints', async () => {
    await expect(
      clnClient.routingHints(
        '02588a9f9835642d8ab1fb8018f2d9cd85b8fb353cc5375f0f7f59cad87a621336',
      ),
    ).resolves.toEqual([]);

    const channels = await clnClient.listChannels(false, false);
    expect(channels.length).toBeGreaterThan(0);

    const routingHints = await clnClient.routingHints(channels[0].remotePubkey);
    expect(routingHints).toHaveLength(0);
  });

  test.each`
    error                        | expected
    ${{
  message: 'Error calling method Xpay: RpcError { code: Some(203), message: "Destination said it doesn\'t know invoice: incorrect_or_unknown_payment_details", data: None }',
}} | ${"Destination said it doesn't know invoice: incorrect_or_unknown_payment_details"}
    ${{ message: 'gRPC error' }} | ${'gRPC error'}
    ${'fail'}                    | ${'fail'}
  `('should parse error', ({ error, expected }) => {
    expect(clnClient['parseError'](error)).toEqual(expected);
  });
});
