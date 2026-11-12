// The BOLT11 invoices test/integration/sidecar/DecodedInvoice.spec.ts
// decodes, for the BLAKE2b network: each sets option_blake2b (512), which
// this backend requires. Signed with a fixed key, so the output is the same
// on every run; the spec's expected values are what this sets.
//
//   node regtest-blake2b/fixtures/bolt11.mjs
import bolt11 from 'bolt11';
import { createHash } from 'node:crypto';

const sha256 = (text) => createHash('sha256').update(text).digest();
const key = sha256('lightning-fork-swap DecodedInvoice fixtures');
const network = {
  bech32: 'bcrt',
  pubKeyHash: 111,
  scriptHash: 196,
  validWitnessVersions: [0, 1],
};

// 8 and 14 required, 17 (MPP) optional, 512 required; `amp` adds AMP's 30
const features = (amp = false) => {
  const bits = new Array(512 - 20 + 1).fill(false);
  bits[512 - 20] = true;
  if (amp) {
    bits[30 - 20] = true;
  }
  return {
    word_length: Math.ceil(513 / 5),
    var_onion_optin: { required: true },
    payment_secret: { required: true },
    basic_mpp: { supported: true },
    extra_bits: { start_bit: 20, bits, has_required: true },
  };
};

const invoice = (name, { msat, timestamp = 1793000000, expiry = 86400, hints, amp } = {}) => {
  const tags = [
    { tagName: 'payment_hash', data: sha256(`${name} hash`).toString('hex') },
    { tagName: 'payment_secret', data: sha256(`${name} secret`).toString('hex') },
    { tagName: 'description', data: '' },
    { tagName: 'expire_time', data: expiry },
    { tagName: 'min_final_cltv_expiry', data: 80 },
    { tagName: 'feature_bits', data: features(amp) },
  ];
  if (hints) {
    tags.push({ tagName: 'routing_info', data: hints });
  }
  const encoded = bolt11.encode({
    network,
    timestamp,
    ...(msat !== undefined ? { millisatoshis: String(msat) } : {}),
    tags,
  });
  return bolt11.sign(encoded, key).paymentRequest;
};

const out = {
  payee: bolt11.decode(invoice('payee')).payeeNodeKey,
  paymentHash: sha256('bolt11 hash').toString('hex'),
  bolt11: invoice('bolt11', { msat: 21_000 }),
  zeroAmount: invoice('zero amount'),
  msat120000323: invoice('msat 1', { msat: 120_000_323 }),
  msat130000323: invoice('msat 2', { msat: 130_000_323 }),
  expired3600: invoice('expired 1', { msat: 50_000_000, timestamp: 1708990426, expiry: 3600 }),
  expired604800: invoice('expired 2', { msat: 123, timestamp: 1708990605, expiry: 604800 }),
  routingInfo: invoice('routing', {
    msat: 1_000_000,
    hints: [
      {
        pubkey: '03e28590a7d2e79140fd10ca62a9c18c3daff8e5994047ae715ae0873719f13aac',
        short_channel_id: '0000940000010000',
        fee_base_msat: 1000,
        fee_proportional_millionths: 1,
        cltv_expiry_delta: 80,
      },
    ],
  }),
  amp: invoice('amp', { msat: 1_000_000, amp: true }),
};
console.log(JSON.stringify(out, null, 2));
