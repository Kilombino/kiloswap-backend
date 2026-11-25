import fs from 'fs';

/**
 * Kiloswap: the swaps' server key lives in the guard (lnd RPC middleware
 * next to the backend), not here. The guard claims submarine swaps' lockups
 * once their payment succeeded and refunds reverse swaps' lockups once
 * their timeout passed, on its own; asking it makes that immediate and
 * returns the transaction for the backend's records.
 *
 *   KILOSWAP_GUARD_URL         http://guard:8091
 *   KILOSWAP_GUARD_TOKEN(_FILE) the shared bearer token
 */
class GuardClient {
  public static enabled = (): boolean =>
    process.env.KILOSWAP_GUARD_URL !== undefined &&
    process.env.KILOSWAP_GUARD_URL !== '';

  private static token = (): string => {
    if (process.env.KILOSWAP_GUARD_TOKEN_FILE) {
      return fs
        .readFileSync(process.env.KILOSWAP_GUARD_TOKEN_FILE, 'utf-8')
        .trim();
    }
    return process.env.KILOSWAP_GUARD_TOKEN || '';
  };

  public static claim = (swapId: string) =>
    GuardClient.post('/v1/claim', swapId);

  public static refund = (swapId: string) =>
    GuardClient.post('/v1/refund', swapId);

  private static post = async (
    path: string,
    swapId: string,
  ): Promise<{ transactionId: string; fee: number }> => {
    const res = await fetch(`${process.env.KILOSWAP_GUARD_URL}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${GuardClient.token()}`,
      },
      body: JSON.stringify({ id: swapId }),
      signal: AbortSignal.timeout(90_000),
    });
    const body = (await res.json().catch(() => ({}))) as {
      transactionId?: string;
      fee?: number;
      error?: string;
    };
    if (!res.ok || body.transactionId === undefined) {
      throw new Error(
        `guard ${path} ${swapId}: ${res.status} ${body.error || ''}`.trim(),
      );
    }
    return { transactionId: body.transactionId, fee: body.fee || 0 };
  };
}

export default GuardClient;
