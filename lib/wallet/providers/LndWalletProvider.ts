// Kiloswap: the main lnd's on-chain wallet as the swap wallet (lab).
//
// Upstream Boltz removed its LND wallet provider in 3cb1eb11 (Aug 2025).
// This brings it back for Kiloswap, where the operator wants the swaps'
// coins in the lnd wallet his other tools see, adapted to this fork:
//   - findSend: the wallet's own record of a payment to an address, which
//     this fork uses so a lockup sent but not recorded is never sent twice;
//   - NotBroadcastError for refusals that sent nothing;
//   - sweepWallet refuses: on the main node it would empty lnd's wallet.
// lnd keeps the anchor reserve out of SendCoins' coin selection by itself,
// and its fee floor is 253 sat/kw (about 1 sat/vB).
import { Transaction } from '@scure/btc-signer';
import { hexToBytes } from '@noble/hashes/utils.js';
import type Logger from '../../Logger';
import { fromProtoInt } from '../../Utils';
import type { IChainClient } from '../../chain/ChainClient';
import type LndClient from '../../lightning/LndClient';
import * as lndrpc from '../../proto/lnd/rpc';
import NotBroadcastError from './NotBroadcastError';
import type { SentTransaction, WalletBalance } from './WalletProviderInterface';
import type WalletProviderInterface from './WalletProviderInterface';

class LndWalletProvider implements WalletProviderInterface {
  public readonly symbol: string;

  // The wallet manager starts before the lnd clients connect (Boltz.start),
  // so the client is looked up when needed, from the currency's map.
  constructor(
    public logger: Logger,
    private readonly lnds: Map<string, LndClient>,
    public chainClient: IChainClient,
  ) {
    this.symbol = chainClient.symbol;
    this.logger.info(`Initialized ${this.symbol} LND wallet`);
  }

  private get lndClient(): LndClient {
    const client = this.lnds.values().next().value;
    if (client === undefined) {
      throw new Error(`no ${this.symbol} lnd connected for the wallet`);
    }
    return client;
  }

  public serviceName = (): string => 'LND';

  public getBalance = (): Promise<WalletBalance> => this.lndClient.getBalance();

  public getAddress = async (_label: string): Promise<string> => {
    const response = await this.lndClient.newAddress(
      lndrpc.AddressType.TAPROOT_PUBKEY,
    );
    return response.address;
  };

  public sendToAddress = async (
    address: string,
    amount: number,
    satPerVbyte: number | undefined,
    label: string,
  ): Promise<SentTransaction> => {
    // The list's start height is read before sending (see handleLndTransaction)
    const { blockHeight } = await this.lndClient.getInfo();
    let txid: string;
    try {
      txid = (
        await this.lndClient.sendCoins(
          address,
          amount,
          Math.max(1, Math.ceil(await this.getFeePerVbyte(satPerVbyte))),
          label,
        )
      ).txid;
    } catch (error) {
      // lnd refuses before broadcasting: not enough funds, the reserve, a
      // middleware veto. Nothing went out.
      const message = String((error as any)?.message ?? error);
      if (
        /insufficient|reserve|not enough|middleware|denied|refused/i.test(message)
      ) {
        throw new NotBroadcastError(error);
      }
      throw error;
    }
    return this.handleLndTransaction(txid, address, blockHeight);
  };

  public sweepWallet = async (): Promise<SentTransaction> => {
    throw new Error(
      'sweeping is disabled for the LND wallet: it would empty the main node',
    );
  };

  public findSend = async (
    address: string,
    since: Date,
  ): Promise<SentTransaction | undefined> => {
    const sinceSeconds = Math.floor(since.getTime() / 1000);
    const send = (await this.recentTransactions()).find(
      (tx) =>
        fromProtoInt(tx.amount) < 0 &&
        fromProtoInt(tx.timeStamp) >= sinceSeconds - 600 &&
        tx.outputDetails.some((o) => o.address === address && !o.isOurAddress),
    );
    return send === undefined
      ? undefined
      : this.handleLndTransaction(send.txHash, address, 0);
  };

  // Kiloswap: lnd's wallet transactions of the last day (or from
  // fromHeight), a page of 500 at a time, at most 20 pages
  private recentTransactions = async (fromHeight = 0) => {
    const { blocks } = await this.chainClient.getBlockchainInfo();
    let start = Math.max(blocks - LndWalletProvider.recentBlocks, 0);
    if (fromHeight > start) {
      start = fromHeight;
    }
    const all: lndrpc.Transaction[] = [];
    let offset = 0;
    for (let page = 0; page < 20; page++) {
      const res = await this.lndClient.getOnchainTransactions(start, offset, 500);
      all.push(...res.transactions);
      if (res.transactions.length < 500) {
        break;
      }
      offset = fromProtoInt(res.lastIndex);
    }
    return all;
  };

  private static readonly recentBlocks = 144;

  private handleLndTransaction = async (
    transactionId: string,
    address: string,
    listStartHeight: number,
  ): Promise<SentTransaction> => {
    const rawTransaction =
      await this.chainClient.getRawTransactionVerbose(transactionId);

    let vout = 0;
    for (const output of rawTransaction.vout) {
      if (output.scriptPubKey.address === address) {
        vout = output.n;
      }
    }

    let fee = 0;
    const tx = (await this.recentTransactions(listStartHeight)).find(
      (t) => t.txHash === transactionId,
    );
    if (tx !== undefined) {
      fee = fromProtoInt(tx.totalFees);
    }

    return {
      fee,
      vout,
      transactionId,
      transaction: Transaction.fromRaw(hexToBytes(rawTransaction.hex)),
    };
  };

  private getFeePerVbyte = async (satPerVbyte?: number) =>
    satPerVbyte || (await this.chainClient.estimateFee());
}

export default LndWalletProvider;
