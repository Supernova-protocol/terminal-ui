/* Jupiter swaps (mainnet) for blue chips, trending coins and graduated launches. */
import { VersionedTransaction } from '@solana/web3.js';
import { api } from './api';
import { wallet } from './wallet';
import { txToBase64 } from './chain';

export type JupOrder = { transaction: string | null; requestId: string; inAmount: string; outAmount: string; priceImpactPct: number; slippageBps: number; router?: string; feeBps?: number };

const fromB64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

export async function order(inputMint: string, outputMint: string, amountRaw: string, slippageBps: number, taker: string) {
  const q = new URLSearchParams({ inputMint, outputMint, amount: amountRaw, slippageBps: String(slippageBps), taker });
  return api.get<JupOrder>(`swap/order?${q}`, 15000);
}

export async function swap(o: { inputMint: string; outputMint: string; amountRaw: string; slippageBps: number; onSigned?: () => void }) {
  const taker = wallet.state.address;
  if (!taker) throw new Error('Connect a wallet first.');
  const ord = await order(o.inputMint, o.outputMint, o.amountRaw, o.slippageBps, taker);
  if (!ord.transaction) throw new Error('No route for this swap right now.');
  const tx = VersionedTransaction.deserialize(fromB64(ord.transaction));
  const signed = await wallet.signOne(tx);
  o.onSigned?.();
  const r = await api.post<{ signature: string; inAmount: string; outAmount: string }>('swap/execute', { signedTransaction: txToBase64(signed), requestId: ord.requestId }, 60000);
  return { signature: r.signature, inAmount: r.inAmount, outAmount: r.outAmount, order: ord };
}
