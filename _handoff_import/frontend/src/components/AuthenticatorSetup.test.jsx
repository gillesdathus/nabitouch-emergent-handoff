import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import QRCode from "qrcode";
import { AuthenticatorSetup, QR_RENDER } from "./AuthenticatorSetup";

const URI = "otpauth://totp/Nabitouch:person%40example.com?secret=JBSWY3DPEHPK3PXP&issuer=Nabitouch&algorithm=SHA1&digits=6&period=30";

async function render() {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => {
    root.render(createElement(AuthenticatorSetup, {
      otpauth: URI,
      secret: "JBSWY3DPEHPK3PXP",
      recoveryCodes: ["code-one"],
      code: "",
      onCode() {},
      onVerify(event) { event.preventDefault(); },
      onCancel() {},
      busy: false,
      error: "",
    }));
  });
  const started = Date.now();
  while (!host.querySelector("[data-testid='login-mfa-qr']") && Date.now() - started < 2000) {
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); });
  }
  return { host, unmount() { act(() => root.unmount()); host.remove(); } };
}

test("the QR code is the local image for the provisioning link", async () => {
  const svg = await QRCode.toString(URI, { ...QR_RENDER, type: "svg" });
  const expected = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  const view = await render();
  const image = view.host.querySelector("[data-testid='login-mfa-qr']");
  expect(image.getAttribute("src")).toBe(expected);
  expect(image.getAttribute("src").startsWith("data:image/svg+xml")).toBe(true);
  expect(image.getAttribute("src").startsWith("http")).toBe(false);
  expect(view.host.innerHTML).not.toMatch(/chart\.googleapis|qrserver|quickchart|api\.qr/);
  expect(view.host.querySelector("[data-testid='login-mfa-manual']").open).toBe(false);
  expect(view.host.textContent).toContain("Secure your account");
  expect(view.host.textContent).toContain("Scan this QR code with your authenticator app.");
  expect(view.host.textContent).toContain("Store these somewhere you can open if the phone is lost.");
  expect(JSON.stringify(localStorage)).not.toContain("JBSWY3DPEHPK3PXP");
  expect(JSON.stringify(sessionStorage)).not.toContain(URI);
  view.unmount();
  expect(document.body.textContent || "").not.toContain("code-one");
});
