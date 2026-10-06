import { hashPassword, verifyPassword } from './password.js';

describe('password hashing', () => {
  it('verifies the password it hashed', async () => {
    const stored = await hashPassword('correct horse');

    expect(await verifyPassword('correct horse', stored)).toBe(true);
  });

  it('rejects a different password', async () => {
    const stored = await hashPassword('correct horse');

    expect(await verifyPassword('wrong horse', stored)).toBe(false);
  });

  it('rejects any password when the stored hash has no separator', async () => {
    expect(await verifyPassword('', '')).toBe(false);
  });

  it('rejects any password when the stored hash part is empty', async () => {
    const [salt] = (await hashPassword('correct horse')).split(':');

    expect(await verifyPassword('anything', `${salt}:`)).toBe(false);
  });

  it('rejects any password when the stored hash is truncated', async () => {
    const stored = await hashPassword('correct horse');

    expect(await verifyPassword('correct horse', stored.slice(0, -2))).toBe(
      false,
    );
  });

  it('never stores the plain password', async () => {
    expect(await hashPassword('correct horse')).not.toContain('correct horse');
  });

  it('salts each hash so the same password hashes differently', async () => {
    const first = await hashPassword('correct horse');
    const second = await hashPassword('correct horse');

    expect(first).not.toBe(second);
  });
});
