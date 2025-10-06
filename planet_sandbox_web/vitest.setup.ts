import '@testing-library/jest-dom/vitest';
import { webcrypto } from 'node:crypto';

//1.- Provide the Web Crypto implementation so HMAC token generation works during unit tests.
if (!globalThis.crypto) {
  Object.defineProperty(globalThis, 'crypto', {
    configurable: true,
    value: webcrypto
  });
}
