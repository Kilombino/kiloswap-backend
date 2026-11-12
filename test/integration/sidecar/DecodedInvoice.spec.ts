import { getHexBuffer } from '../../../lib/Utils';
import { InvoiceFeature } from '../../../lib/lightning/LightningClient';
import { InvoiceType } from '../../../lib/sidecar/DecodedInvoice';
import Sidecar from '../../../lib/sidecar/Sidecar';
import { sidecar, startSidecar } from './Utils';

// For the BLAKE2b network, with option_blake2b (512), which this fork
// requires. BOLT11: regtest-blake2b/fixtures/bolt11.mjs (fixed key);
// BOLT12: an offer of cln-1 on the BLAKE2b regtest and an invoice for it
// fetched by cln-2 (regtest-blake2b: privkeyio's BLAKE2b Core Lightning).
const bolt11 =
  'lnbcrt210n1p4d7qjqpp5sm5c77n0ql0w8pumdxd993jqywmhxup2hnr02achefpkjx7cw8dssp5nry6mlde97fwtejcf73z4na8d4gyzkcgvyu2m05mnnnaqjm9pxrqdqqxqyz5vqcqzzs9r8yqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqysgqhz5gg4zt3mzpvk7lfkg4kyv326zxt2y23gxe72azv9qmv3cjnrp8gak23wkj74edjulgylcajcy6j5tz4saue65x7h245lh44huzwhsphku6gt';

const bolt12Offer =
  'lno1qgsqvgnwgcg35z6ee2h3yczraddm72xrfua9uve2rlrm9deu7xyfzrc2qanxj7r5w4ex2rzpqyqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqzcss93gzmduz5zr8fmtzp5t0angfgnf95mj32aymhwwlwx70fez3xshp';

const bolt12Invoice =
  'lni1qqgqu4x3nhjh44a3yfytd9kvv39pwq3qqc3xu3s3rg94nj40zfsy866mhu5vxne6tcej5878k2mneuvgjy8s5pmxd9u8gatjv5xyzqgqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq93pqtzs9kmc9gyxwnkkyrgklmxsj3xjtfh9z46fhwua7udu7nj9zdpwz5pqqc3xu3s3rg94nj40zfsy866mhu5vxne6tcej5878k2mneuvgjy84yq4yzp2yzqgqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqkppqvmmustv8mw22she3yd5mu6fyjr37wvflmusp8q2w6v298txflmu3gycqtzs9kmc9gyxwnkkyrgklmxsj3xjtfh9z46fhwua7udu7nj9zdpwzqk9v24txvcznwt4khsryj4lfw3675at8aqm8u7fc7s4gu0xdrk5mgqs89uu78plu2zvenzeyrlrrc7yuc2n3t7a6x5mfarql6ejkscxycvvqqepja3rqwss5psk6upe3y203x47evh0kmvhkwer9jf2ngll7c75zssp6qxt7kgyn8pktcdp3m8c8kskz3d2y8qqqqqqqqqqqqqqqysqqqqqqqqqqqqp6f9jm7k9yqqqqqq2gpr27c5g92pqsquyal5jud8tgqvpvw8m7j50a5v6yulkg39uu38yt4yqljuhlha65q4yzzhyzqgqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqgqqpvppqtzs9kmc9gyxwnkkyrgklmxsj3xjtfh9z46fhwua7udu7nj9zdpwruzqwvk58357axyz65uc0avaljg3rgufl8vj9ju4cqjrspdnfxtgln7pncygj7nqd078g0yz0pqtzrwykyzn9etmsntkuztpcgl3kf0md4q';

describe('DecodedInvoice', () => {
  beforeAll(async () => {
    await startSidecar();
    await sidecar.connect(
      { on: jest.fn(), removeAllListeners: jest.fn() } as any,
      {} as any,
      false,
    );
  });

  afterAll(async () => {
    sidecar.disconnect();
    await Sidecar.stop();
  });

  test.each`
    type                         | pretty            | input
    ${InvoiceType.Bolt11}        | ${'BOLT11'}       | ${bolt11}
    ${InvoiceType.Offer}         | ${'BOLT12 offer'} | ${bolt12Offer}
    ${InvoiceType.Bolt12Invoice} | ${'BOLT12'}       | ${bolt12Invoice}
  `('should decode invoice type $pretty', async ({ type, pretty, input }) => {
    const decoded = await sidecar.decodeInvoiceOrOffer(input);
    expect(decoded.type).toEqual(type);
    expect(decoded.typePretty).toEqual(pretty);
  });

  test.each`
    payee                                                                   | input
    ${'0211792d0df3ac01fab0af90a98caa29d69f769e84904e3d29e3d42b470452dffc'} | ${bolt11}
    ${'02c502db782a08674ed620d16fecd0944d25a6e515749bbb9df71bcf4e451342e1'} | ${bolt12Offer}
    ${'02c502db782a08674ed620d16fecd0944d25a6e515749bbb9df71bcf4e451342e1'} | ${bolt12Invoice}
  `('should get payee of $input', async ({ payee, input }) => {
    const dec = await sidecar.decodeInvoiceOrOffer(input);
    expect(dec.payee!.toString('hex')).toEqual(payee);
  });

  test.each`
    amount    | input
    ${21_000} | ${bolt11}
    ${0}      | ${bolt12Offer}
    ${42_000} | ${bolt12Invoice}
  `('should get amount of $input', async ({ amount, input }) => {
    const dec = await sidecar.decodeInvoiceOrOffer(input);
    expect(dec.amountMsat).toEqual(amount);
  });

  test('should decode invoice with 0 amount', async () => {
    const dec = await sidecar.decodeInvoiceOrOffer(
      'lnbcrt1p4d7qjqpp5sty529u278felwar7zjn2nckskdgeu54fwq642czwl052dwd7x6qsp5v7d9zwet6xcfuw0quup6g06l6mewys7e9nrzufshkm3zp3csf6csdqqxqyz5vqcqzzs9r8yqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqysgqyeuuw086g79szx9f97mm9ay2nn7y82qjxnr64w3cfy6p4eswtev83t8vhqg02ew98nxsnju46uh70w8zlwvscun8hwdqev49ahhtetgp7cv0jc',
    );
    expect(dec.amountMsat).toEqual(0);
  });

  test.each`
    expected       | invoice
    ${120_000_323} | ${'lnbcrt1200003230p1p4d7qjqpp54s0qx7936pcfajwyt06gqdgkgjh6u9jmfhnv6jz6ss6688y4yvkssp5w97y8h5um9jgcwzr7w79u7cc3zc74hyepq0mcwqqcu0vnqfrzt2sdqqxqyz5vqcqzzs9r8yqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqysgqjudhfl0jc7mwypft0nn7p7qahvlmkkx3fmkm9k4fs8axlxmxtc5pj0xl678yyhmg2d64rn00l0w0ap94fh2afgqnjf89glj2a7eyzuqqkzslud'}
    ${130_000_323} | ${'lnbcrt1300003230p1p4d7qjqpp5clpzgwzw9pynvxdhenhqlpewvthtxzz4p4fzeypp2f22eq0zws9ssp584303t8fx4a0hlhg6zkqxrtrk5vthr7n5w6n9dfm2e34fhkkz4usdqqxqyz5vqcqzzs9r8yqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqysgq8akhgc07vdrdj77x6epwrq8y6gge4av04mqn3cq8hg8kzvdkdtjk72nrenyc3jf8xn5xrfr9euld4c8e70q5xhauklsdczy49n5hkuqprxlc5g'}
  `(
    'should decode invoice with msats precision',
    async ({ expected, invoice }) => {
      const dec = await sidecar.decodeInvoiceOrOffer(invoice);
      expect(dec.amountMsat).toEqual(expected);
    },
  );

  test.each`
    paymentHash                                                           | input
    ${'86e98f7a6f07dee3879b699a52c64023b773702abcc6f57717ca43691bd871db'} | ${bolt11}
    ${undefined}                                                          | ${bolt12Offer}
    ${'80384efe92e34eb40181638fbf4a8fed19a273f6444bce44e45d480fcb97fdfb'} | ${bolt12Invoice}
  `('should get payment hash of $input', async ({ paymentHash, input }) => {
    const dec = await sidecar.decodeInvoiceOrOffer(input);
    expect(
      dec.paymentHash !== undefined
        ? dec.paymentHash.toString('hex')
        : undefined,
    ).toEqual(paymentHash);
  });

  test.each`
    expected               | invoice
    ${1708990426 + 3600}   | ${'lnbcrt500u1pja6876pp5dpx0mve790vqk2ylsv6a06nrzr5uznwsqhcvxgsuyyxjypfn9e3ssp52uterhh4paqzn0e8qfxcqx2djcztc8l56v88f48qv98lnp6j2evqdqqxqrrsscqzzs9r8yqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqysgqejtea5wsqw4uhwe2fgfn75htxzme90hn524d640ecqshe729837kfxdywukneuxqt8h7m2s8q7mhv2hmzvs8l03f82jh80elh9m68vgq95m66t'}
    ${1708990605 + 604800} | ${'lnbcrt1230p1pja6gydpp5k560gx43h2c0ql700s9squ29ug9uaenycra3elw9pv8sramlpnqqsp57ya0rqr5ywddhfj8t2jt7a2r79l7d4524glx4v2ec4qtfhsrvacqdqqxqyjw5qcqzzs9r8yqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqysgqm7yg76dgcl3vxep2elhsam09dpr2s4hxr8ta9nk3z50ng982gg384687u95v62p96n6nj5ty3d5dj7xesjvc9edc0hlfh04z426v5wsqpdy9ng'}
    ${1794517122 + 7200}   | ${bolt12Invoice}
  `(
    'should decode invoice expiry of $invoice',
    async ({ invoice, expected }) => {
      const dec = await sidecar.decodeInvoiceOrOffer(invoice);

      // The BOLT12 invoice expires two hours after it was made
      expect(dec.isExpired).toEqual(Date.now() / 1000 > expected);
      expect(dec.expiryTimestamp).toEqual(expected);
    },
  );

  test('should decode routing info', async () => {
    const dec = await sidecar.decodeInvoiceOrOffer(
      'lnbcrt10u1p4d7qjqpp5jf582muguasxkm8dla66lz6tletzztj8j4cfl3zj82m9vfc6rpxqsp5yqqtggd8w27nhl456vdjkkdvhrlreng3trapjuj3w2jgft03yxlsdqqxqyz5vqcqzzs9r8yqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqysgqrzjq03gty986tnezs8azr9x92wp3s76l789n9qy0tn3ttsgwdce7ya2cqqqjsqqqqgqqqqqqqlgqqqqqqgq2qv34qyuvz4xfjrcmmchsqjxyy7cprlcv0ppf7ytun073enxzkw364wxjhw7r28xrcy4sm96klldhjcy9ns2g3jzp6a03evatmtrw2fecqlg73gz',
    );

    expect(dec.routingHints).toEqual([
      [
        {
          feeBaseMsat: 1000,
          cltvExpiryDelta: 80,
          chanId: '162727720976384',
          feeProportionalMillionths: 1,
          nodeId:
            '03e28590a7d2e79140fd10ca62a9c18c3daff8e5994047ae715ae0873719f13aac',
        },
      ],
    ]);
  });

  test('should get paths', async () => {
    const dec = await sidecar.decodeInvoiceOrOffer(bolt12Invoice);
    expect(dec.paths).toEqual([
      {
        nodeId: getHexBuffer(
          '02c502db782a08674ed620d16fecd0944d25a6e515749bbb9df71bcf4e451342e1',
        ),
        shortChannelId: undefined,
      },
    ]);
  });

  test.each`
    expected                | invoice
    ${[InvoiceFeature.MPP]} | ${bolt11}
    ${[InvoiceFeature.MPP]} | ${bolt12Invoice}
  `('should decode features', async ({ expected, invoice }) => {
    const dec = await sidecar.decodeInvoiceOrOffer(invoice);
    expect(dec.features).toEqual(new Set(expected));
  });

  test('should throw when decoding AMP invoices', async () => {
    await expect(
      sidecar.decodeInvoiceOrOffer(
        'lnbcrt10u1p4d7qjqpp5mkq9qzf20cdpu6ymsehw2akftu4dwdj59dkwdxyh0sfxf7tnl7essp5h6ufy6apuwswqyl3jxcukae47uxu3nk0eupnflz4qduyfjt2kr6sdqqxqyz5vqcqzzs9r8yqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqpqqysgqusar0xr37fg0me8m40zy8ke9v0c7a70s5e2mnjhzrklzwat7f7tn0jpnjkmuvq2sv5w2mp5ytwrcnxc7m0rfwnd0fz84j3gqalwd6kgprnjs7e',
      ),
    ).rejects.toEqual(expect.anything());
  });

  test.each`
    expected | invoice
    ${80}    | ${bolt11}
    ${18}    | ${bolt12Invoice}
  `('should get min final CLTV', async ({ expected, invoice }) => {
    const dec = await sidecar.decodeInvoiceOrOffer(invoice);
    expect(dec.minFinalCltv).toEqual(expected);
  });
});
