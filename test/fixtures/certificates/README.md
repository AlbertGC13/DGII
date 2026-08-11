# Public Synthetic PKCS#12 Fixture

`synthetic-test-certificate.p12` is purpose-built public test data. It contains a newly generated 2048-bit RSA private key and a self-signed certificate with these intentionally unmistakable values:

- Common Name: `Synthetic PKCS#12 Fixture - Not a Real Identity`
- Organization: `Synthetic Test Data Only`
- Subject `serialNumber` (OID `2.5.4.5`): `000000000`
- Password: `synthetic-test-password`

It contains no real person, taxpayer, certificate, credential, or production secret. The password is public and must never be reused outside tests.

## Integrity

SHA-256: `195bdcf6fdd90d2f07272048bfbb69438d0f01589b5121d00021ffa509ab5dc3`

Validate the checked-in fixture with:

```bash
pnpm validate:synthetic-pkcs12-fixture
```

## Regeneration

Regenerate only intentionally with:

```bash
pnpm generate:synthetic-pkcs12-fixture
```

Generation uses `node-forge@1.4.0` entirely in memory; it does not call OpenSSL, a shell command, a network service, or create temporary key material. RSA key and certificate generation are securely random and non-deterministic, so regeneration changes the binary and its SHA-256. Update this README's hash, run validation, and require review of every fixture replacement.

The package-consumer smoke test asserts that this fixture and its generator are absent from the packed npm tarball.
