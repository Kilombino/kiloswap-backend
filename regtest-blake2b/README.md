# Boltz's regtest on the Bitcoin BLAKE2b chain

The integration tests (`test/integration`, `boltzr`'s `cargo test`) run against
Boltz's regtest (`../regtest`, the `BoltzExchange/regtest` submodule). This
folder lays a compose file over it so that the Bitcoin side is the BLAKE2b chain
this fork serves, as in production:

| Service                                    | Upstream                            | Here                                                                                                                           |
| ------------------------------------------ | ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `bitcoind`                                 | Bitcoin Core                        | Bitcoin Knots 29.4.2 (`knots/`, the build production runs), BLAKE2b rules from block 20                                        |
| `lnd-1..3`                                 | lnd                                 | Lightning Fork, the image production runs                                                                                      |
| `cln-1..2`                                 | Core Lightning with Boltz's plugins | privkeyio's BLAKE2b Core Lightning, with Boltz's plugins and a patched `hold` (`cln/`)                                         |
| Liquid, EVM chains, Postgres, Redis        |                                     | unchanged                                                                                                                      |
| electrs, Esplora, NBXplorer, arkd, fulmine |                                     | not started: they read Bitcoin blocks themselves and cannot parse a BLAKE2b header; the service offers neither Esplora nor Ark |

The tests that need Ark are skipped with `BOLTZ_REGTEST_ARK=off`
(`test/integration/Nodes.ts`; `cargo test -- --skip ark::`).

## Running it

```sh
npm run regtest:start:ci:blake2b     # the regtest, its test database, the EVM contracts
BOLTZ_REGTEST_ARK=off node run-int.js
BOLTZ_REGTEST_ARK=off cargo test -- --skip ark::
```

On a machine whose own Postgres holds port 5432:
`LOCAL=1 regtest-blake2b/start.sh` maps the regtest's to 15432, and the tests
take `BOLTZ_TEST_DB_PORT=15432`.

The volumes have names of their own (`lfswap-b2b-*`): upstream's (`boltz-*`) are
global, and would be shared with any other checkout of Boltz's regtest on the
machine.

## The hold plugin

Boltz's `hold` plugin makes its invoices itself, with rust-lightning, and the
node then signs them. On the BLAKE2b network every invoice must require
`option_blake2b` (feature bit 512); the plugin's did not, so the network's
nodes, and this backend, refused them. `cln/hold-required-features.patch`:

- hold invoices carry every feature the node requires in its own invoices (from
  `getinfo`'s `our_features.invoice`): 512 on the BLAKE2b network, nothing new
  on any other;
- rust-lightning knows 512 (`[patch.crates-io]` with
  `cln/lightning-types-blake2b.patch`, the change this backend's
  `vendor/lightning-types` carries), so the plugin can decode its invoices when
  they are paid, and inject ones made elsewhere.

`cln/Dockerfile` builds the plugin from Boltz's source at the commit `../hold`
pins, with both patches, and runs its tests.

## Fixtures

`fixtures/bolt11.mjs` makes the BOLT11 invoices
`test/integration/sidecar/DecodedInvoice.spec.ts` decodes (fixed key,
option_blake2b set). Its BOLT12 offer and invoice, and the ones in
`test/integration/lightning/cln/ClnClient.spec.ts`, came from cln-1 and cln-2 on
this regtest.
