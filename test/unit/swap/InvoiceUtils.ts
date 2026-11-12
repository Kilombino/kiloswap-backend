import { secp256k1 } from '@noble/curves/secp256k1.js';
import { randomBytes } from '@noble/hashes/utils.js';
import bolt11 from 'bolt11';
import { getHexString, getUnixTime } from '../../../lib/Utils';
import type { BitcoinNetwork } from '../../Networks';
import { regtest as regtestNetwork } from '../../Networks';

const invoiceSigningKeys = (() => {
  const privateKey = randomBytes(32);
  return {
    privateKey: Buffer.from(privateKey),
    publicKey: Buffer.from(secp256k1.getPublicKey(privateKey, true)),
  };
})();

// var_onion_optin (8) and payment_secret (14) required, option_blake2b
// (512) required. bolt11 lists the bits from 20 up in extra_bits.
const blake2bFeatureBits = () => {
  const bits = new Array(512 - 20 + 1).fill(false);
  bits[512 - 20] = true;
  return {
    word_length: Math.ceil(513 / 5),
    var_onion_optin: { required: true },
    payment_secret: { required: true },
    extra_bits: { start_bit: 20, bits, has_required: true },
  };
};

export const createInvoice = (
  preimageHash?: string,
  timestamp?: number,
  expiry?: number,
  satoshis?: number,
  network: BitcoinNetwork = regtestNetwork,
): string => {
  const invoiceEncode = bolt11.encode({
    network: {
      ...network,
      validWitnessVersions: [0, 1],
    },
    satoshis: satoshis || 100,
    timestamp: timestamp || getUnixTime(),
    payeeNodeKey: getHexString(Buffer.from(invoiceSigningKeys.publicKey)),
    tags: [
      {
        data: preimageHash || getHexString(randomBytes(32)),
        tagName: 'payment_hash',
      },
      {
        data: getHexString(randomBytes(32)),
        tagName: 'payment_secret',
      },
      {
        data: expiry || 3600,
        tagName: 'expire_time',
      },
      {
        // The BLAKE2b network's invoices carry option_blake2b (512): its
        // nodes, and this fork's backend, refuse one without it
        data: blake2bFeatureBits(),
        tagName: 'feature_bits',
      },
    ],
  });

  return bolt11.sign(invoiceEncode, Buffer.from(invoiceSigningKeys.privateKey!))
    .paymentRequest!;
};
