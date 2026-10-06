/* Test-only Wallet Standard wallet (seed 7, matches scripts/mock). Injected by Playwright, never shipped. */
(() => {
  const nacl = window.nacl;
  const kp = nacl.sign.keyPair.fromSeed(new Uint8Array(32).fill(7));
  const A = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  const b58 = (bytes) => {
    const digits = [0];
    for (const byte of bytes) { let carry = byte; for (let j = 0; j < digits.length; j++) { carry += digits[j] << 8; digits[j] = carry % 58; carry = (carry / 58) | 0; } while (carry) { digits.push(carry % 58); carry = (carry / 58) | 0; } }
    let s = ''; for (const b of bytes) { if (b === 0) s += '1'; else break; }
    for (let i = digits.length - 1; i >= 0; i--) s += A[digits[i]];
    return s;
  };
  const address = b58(kp.publicKey);
  const account = { address, publicKey: kp.publicKey, chains: ['solana:devnet', 'solana:mainnet'], features: ['solana:signTransaction', 'solana:signMessage'], label: 'Test' };
  const cu16 = (buf, off) => { let len = 0, size = 0; for (;;) { const b = buf[off + size]; len |= (b & 0x7f) << (size * 7); size++; if ((b & 0x80) === 0) break; } return [len, size]; };
  function signTx(bytes) {
    const tx = Uint8Array.from(bytes);
    const [nSig, s1] = cu16(tx, 0);
    const msg = tx.subarray(s1 + 64 * nSig);
    let o = msg[0] & 0x80 ? 1 : 0;
    const numReq = msg[o]; o += 3;
    const [nKeys, s2] = cu16(msg, o); o += s2;
    for (let i = 0; i < Math.min(numReq, nKeys); i++) {
      const key = msg.subarray(o + i * 32, o + i * 32 + 32);
      if (key.every((v, j) => v === kp.publicKey[j])) tx.set(nacl.sign.detached(msg, kp.secretKey), s1 + 64 * i);
    }
    return tx;
  }
  const wallet = {
    version: '1.0.0', name: 'Test Wallet',
    icon: 'data:image/svg+xml;base64,' + btoa('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="8" fill="#00F3FF"/></svg>'),
    chains: ['solana:devnet', 'solana:mainnet'],
    get accounts() { return window.__twConnected ? [account] : []; },
    features: {
      // like a real wallet, the site stays trusted across page loads until it disconnects
      'standard:connect': { version: '1.0.0', connect: async (opts) => { const trusted = localStorage.getItem('__tw_trusted') === '1'; if (opts && opts.silent && !trusted) return { accounts: [] }; localStorage.setItem('__tw_trusted', '1'); return { accounts: [account] }; } },
      'standard:disconnect': { version: '1.0.0', disconnect: async () => { localStorage.removeItem('__tw_trusted'); } },
      'standard:events': { version: '1.0.0', on: () => () => {} },
      'solana:signTransaction': { version: '1.0.0', supportedTransactionVersions: ['legacy', 0], signTransaction: async (...inputs) => { window.__twSigned = (window.__twSigned || 0) + inputs.length; return inputs.map((i) => ({ signedTransaction: signTx(i.transaction) })); } },
      'solana:signMessage': { version: '1.0.0', signMessage: async (...inputs) => inputs.map((i) => ({ signedMessage: i.message, signature: nacl.sign.detached(i.message, kp.secretKey) })) },
    },
  };
  const register = (api) => api.register(wallet);
  window.addEventListener('wallet-standard:app-ready', (e) => register(e.detail));
  window.dispatchEvent(new CustomEvent('wallet-standard:register-wallet', { detail: register }));
})();
