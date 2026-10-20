import { restrictedFlag } from "./feature-flags";

test("a missing settings payload does not turn restricted features on", () => {
  expect(restrictedFlag(undefined, "cardCheckoutEnabled")).toBe(false);
  expect(restrictedFlag(null, "documentUploadsEnabled")).toBe(false);
  expect(restrictedFlag({}, "cardCheckoutEnabled")).toBe(false);
  expect(restrictedFlag({ cardCheckoutEnabled: false }, "cardCheckoutEnabled")).toBe(false);
  expect(restrictedFlag({ documentUploadsEnabled: "true" }, "documentUploadsEnabled")).toBe(false);
  expect(restrictedFlag({ cardCheckoutEnabled: 1 }, "cardCheckoutEnabled")).toBe(false);
});

test("the server can turn a restricted feature on only with boolean true", () => {
  expect(restrictedFlag({ cardCheckoutEnabled: true, documentUploadsEnabled: true }, "cardCheckoutEnabled")).toBe(true);
  expect(restrictedFlag({ documentUploadsEnabled: true }, "documentUploadsEnabled")).toBe(true);
  expect(restrictedFlag({ securityShieldFleetEnabled: true }, "securityShieldFleetEnabled")).toBe(true);
  expect(restrictedFlag({ securityShieldFleetEnabled: "true" }, "securityShieldFleetEnabled")).toBe(false);
  expect(restrictedFlag({ securityShieldDocsEnabled: true, securityShieldArrivalCodeEnabled: true }, "securityShieldDocsEnabled")).toBe(true);
});
