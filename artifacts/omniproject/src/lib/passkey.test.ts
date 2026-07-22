import { describe, it, expect, afterEach, vi } from "vitest";
import { passkeySupported, enrolPasskey, passkeyStepUp } from "./passkey";

/**
 * WebAuthn passkey ceremonies (browser side). jsdom exposes neither `PublicKeyCredential` nor
 * `navigator.credentials`, so the capability probe reports unsupported and both ceremonies throw
 * up front. When we stub a platform authenticator + `navigator.credentials`, the full enrol/step-up
 * happy paths run (including the base64/base64url (de)coders) and every error arm is exercised.
 */

/** Install a fake WebAuthn-capable browser: window.PublicKeyCredential + navigator.credentials. */
function stubSupported(credentials: { create?: unknown; get?: unknown }): void {
  vi.stubGlobal("PublicKeyCredential", class {});
  vi.stubGlobal("navigator", { credentials });
}

/** An ArrayBuffer with the given bytes (WebAuthn returns ArrayBuffers). */
const buf = (...bytes: number[]): ArrayBuffer => new Uint8Array(bytes).buffer;

afterEach(() => vi.unstubAllGlobals());

describe("passkeySupported", () => {
  it("is false in a browser without WebAuthn (jsdom default)", () => {
    expect(passkeySupported()).toBe(false);
  });

  it("is true once PublicKeyCredential + navigator.credentials exist", () => {
    stubSupported({ create: vi.fn(), get: vi.fn() });
    expect(passkeySupported()).toBe(true);
  });
});

describe("enrolPasskey", () => {
  it("throws when the browser doesn't support passkeys", async () => {
    await expect(enrolPasskey("user-1")).rejects.toThrow(/doesn't support passkeys/);
  });

  it("creates a credential, reads the SPKI key and registers it with the server", async () => {
    const create = vi.fn(() =>
      Promise.resolve({
        rawId: buf(1, 2, 3, 4),
        response: { getPublicKey: () => buf(9, 8, 7, 6) } as unknown as AuthenticatorAttestationResponse,
      }),
    );
    stubSupported({ create });
    const fetchMock = vi.fn(() => Promise.resolve(new Response("{}", { status: 200 })));
    vi.stubGlobal("fetch", fetchMock);

    await expect(enrolPasskey("user-1", "MyLabel")).resolves.toBeUndefined();

    // create() gets the right publicKey ceremony options.
    const opts = (create.mock.calls[0]![0] as { publicKey: PublicKeyCredentialCreationOptions }).publicKey;
    expect(opts.rp.name).toBe("MyLabel");
    expect(opts.user.name).toBe("user-1");
    expect(opts.pubKeyCredParams[0]!.alg).toBe(-7);

    // Server registration carries base64url credentialId (no padding, url-safe) + base64 SPKI.
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("/api/approvals/passkey");
    const body = JSON.parse(String((init as RequestInit).body)) as { credentialId: string; publicKeySpki: string };
    expect(body.credentialId).not.toMatch(/[+/=]/); // base64url, unpadded
    expect(body.publicKeySpki.length).toBeGreaterThan(0);
  });

  it("defaults the label to \"OmniProject\"", async () => {
    const create = vi.fn(() => Promise.resolve({ rawId: buf(1), response: { getPublicKey: () => buf(2) } }));
    stubSupported({ create });
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(new Response("{}", { status: 200 }))));
    await enrolPasskey("u2");
    const opts = (create.mock.calls[0]![0] as { publicKey: PublicKeyCredentialCreationOptions }).publicKey;
    expect(opts.rp.name).toBe("OmniProject");
  });

  it("throws when the ceremony is cancelled (null credential)", async () => {
    stubSupported({ create: vi.fn(() => Promise.resolve(null)) });
    vi.stubGlobal("fetch", vi.fn());
    await expect(enrolPasskey("u1")).rejects.toThrow(/cancelled/);
  });

  it("throws when the authenticator returns no public key (getPublicKey returns undefined)", async () => {
    stubSupported({ create: vi.fn(() => Promise.resolve({ rawId: buf(1), response: { getPublicKey: () => undefined } })) });
    vi.stubGlobal("fetch", vi.fn());
    await expect(enrolPasskey("u1")).rejects.toThrow(/usable public key/);
  });

  it("throws when the authenticator lacks getPublicKey entirely (optional-chaining arm)", async () => {
    stubSupported({ create: vi.fn(() => Promise.resolve({ rawId: buf(1), response: {} })) });
    vi.stubGlobal("fetch", vi.fn());
    await expect(enrolPasskey("u1")).rejects.toThrow(/usable public key/);
  });

  it("throws when the server rejects the registration", async () => {
    stubSupported({ create: vi.fn(() => Promise.resolve({ rawId: buf(1), response: { getPublicKey: () => buf(2) } })) });
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(new Response("nope", { status: 500 }))));
    await expect(enrolPasskey("u1")).rejects.toThrow(/register the passkey with the server/);
  });
});

describe("passkeyStepUp", () => {
  it("throws when the browser doesn't support passkeys", async () => {
    await expect(passkeyStepUp()).rejects.toThrow(/doesn't support passkeys/);
  });

  it("returns needsEnrolment when the user has no passkey (409)", async () => {
    stubSupported({ get: vi.fn() });
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(new Response("{}", { status: 409 }))));
    expect(await passkeyStepUp()).toEqual({ ok: false, needsEnrolment: true });
  });

  it("throws when the challenge request fails", async () => {
    stubSupported({ get: vi.fn() });
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(new Response("boom", { status: 500 }))));
    await expect(passkeyStepUp()).rejects.toThrow(/start passkey verification/);
  });

  it("runs the assertion and posts it; resolves { ok: true } on success", async () => {
    const get = vi.fn(() =>
      Promise.resolve({
        rawId: buf(5, 6, 7, 8),
        response: { clientDataJSON: buf(1, 2), authenticatorData: buf(3, 4), signature: buf(5, 6) } as unknown as AuthenticatorAssertionResponse,
      }),
    );
    stubSupported({ get });
    const fetchMock = vi.fn((url: string) => {
      if (String(url).includes("challenge")) {
        return Promise.resolve(new Response(JSON.stringify({ challenge: "YWJj", rpId: "localhost", credentialIds: ["YWJjZA"] }), { status: 200 }));
      }
      return Promise.resolve(new Response("{}", { status: 200 }));
    });
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);

    expect(await passkeyStepUp()).toEqual({ ok: true });

    // The challenge (base64url) was decoded and handed to navigator.credentials.get with the allow-list.
    const getOpts = (get.mock.calls[0]![0] as { publicKey: PublicKeyCredentialRequestOptions }).publicKey;
    expect(getOpts.rpId).toBe("localhost");
    expect(getOpts.allowCredentials).toHaveLength(1);
    expect(getOpts.challenge).toBeInstanceOf(ArrayBuffer);

    // The assertion is posted with base64url fields + the echoed challenge.
    const post = fetchMock.mock.calls.find((c) => String(c[0]).endsWith("/step-up"))!;
    const body = JSON.parse(String((post[1] as RequestInit).body)) as Record<string, string>;
    expect(body.challenge).toBe("YWJj");
    expect(body.credentialId).not.toMatch(/[+/=]/);
    expect(body.clientDataJSON.length).toBeGreaterThan(0);
    expect(body.authenticatorData.length).toBeGreaterThan(0);
    expect(body.signature.length).toBeGreaterThan(0);
  });

  it("throws when the assertion is cancelled (null)", async () => {
    stubSupported({ get: vi.fn(() => Promise.resolve(null)) });
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(new Response(JSON.stringify({ challenge: "YWJj", rpId: "localhost", credentialIds: [] }), { status: 200 }))));
    await expect(passkeyStepUp()).rejects.toThrow(/verification was cancelled/);
  });

  it("throws the server's error message when the final verify fails (JSON error body)", async () => {
    stubSupported({ get: vi.fn(() => Promise.resolve({ rawId: buf(1), response: { clientDataJSON: buf(1), authenticatorData: buf(2), signature: buf(3) } })) });
    vi.stubGlobal("fetch", vi.fn((url: string) =>
      String(url).includes("challenge")
        ? Promise.resolve(new Response(JSON.stringify({ challenge: "YWJj", rpId: "localhost", credentialIds: ["YWJj"] }), { status: 200 }))
        : Promise.resolve(new Response(JSON.stringify({ error: "signature invalid" }), { status: 400 })),
    ) as unknown as typeof fetch);
    await expect(passkeyStepUp()).rejects.toThrow("signature invalid");
  });

  it("throws a default message when the final verify fails with a non-JSON body", async () => {
    stubSupported({ get: vi.fn(() => Promise.resolve({ rawId: buf(1), response: { clientDataJSON: buf(1), authenticatorData: buf(2), signature: buf(3) } })) });
    vi.stubGlobal("fetch", vi.fn((url: string) =>
      String(url).includes("challenge")
        ? Promise.resolve(new Response(JSON.stringify({ challenge: "YWJj", rpId: "localhost", credentialIds: ["YWJj"] }), { status: 200 }))
        : Promise.resolve(new Response("<html>", { status: 500 })),
    ) as unknown as typeof fetch);
    await expect(passkeyStepUp()).rejects.toThrow(/Passkey verification failed/);
  });
});
