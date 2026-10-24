import { beforeEach, describe, expect, it, vi } from "vitest";

async function loadInterceptors() {
  const handlers = { request: null, responseError: null };
  const http = vi.fn();
  http.post = vi.fn();
  http.interceptors = {
    request: { use: (fn) => { handlers.request = fn; } },
    response: { use: (_ok, err) => { handlers.responseError = err; } },
  };

  vi.doMock("axios", () => ({
    default: { create: () => http },
  }));
  vi.doMock("./native", () => ({
    attachNative: () => {},
    isNative: () => false,
    nativeAuth: () => ({}),
  }));
  Object.defineProperty(globalThis, "document", {
    value: { cookie: "" },
    configurable: true,
  });

  await import("./api.js");
  return { handlers, http };
}

describe("api session retry after dead cookies", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllGlobals();
  });

  it("retries guest-safe geo confirm once when refresh fails after 401", async () => {
    const { handlers, http } = await loadInterceptors();
    const cfg = { url: "/geo/confirm", method: "post", headers: {} };
    const refreshErr = { response: { status: 401, data: { detail: "Session expired" } }, config: cfg };
    http.post.mockRejectedValueOnce(refreshErr);
    http.mockResolvedValueOnce({ data: { accepted: true } });

    const result = await handlers.responseError({
      response: { status: 401, data: { detail: "Session expired" } },
      config: cfg,
    });

    expect(http.post).toHaveBeenCalledWith("/auth/refresh");
    expect(http).toHaveBeenCalledWith(cfg);
    expect(result).toEqual({ data: { accepted: true } });
  });

  it("does not replay payment mutations after failed refresh", async () => {
    const { handlers, http } = await loadInterceptors();
    const cfg = { url: "/invoices/inv-1/checkout", method: "post", headers: {} };
    http.post.mockRejectedValueOnce({ response: { status: 401 }, config: { url: "/auth/refresh" } });

    await expect(handlers.responseError({
      response: { status: 401, data: { detail: "Session expired" } },
      config: cfg,
    })).rejects.toMatchObject({ response: { status: 401 } });

    expect(http.post).toHaveBeenCalledWith("/auth/refresh");
    expect(http).not.toHaveBeenCalled();
  });

  it("does not replay booking create after failed refresh", async () => {
    const { handlers, http } = await loadInterceptors();
    const cfg = { url: "/bookings", method: "post", headers: {} };
    http.post.mockRejectedValueOnce({ response: { status: 401 }, config: { url: "/auth/refresh" } });

    await expect(handlers.responseError({
      response: { status: 401, data: { detail: "Session expired" } },
      config: cfg,
    })).rejects.toMatchObject({ response: { status: 401 } });

    expect(http).not.toHaveBeenCalled();
  });

  it("retries at most once", async () => {
    const { handlers, http } = await loadInterceptors();
    const cfg = { url: "/geo/check", method: "post", headers: {}, _retry: true };

    await expect(handlers.responseError({
      response: { status: 401, data: { detail: "Session expired" } },
      config: cfg,
    })).rejects.toMatchObject({ response: { status: 401 } });

    expect(http.post).not.toHaveBeenCalled();
    expect(http).not.toHaveBeenCalled();
  });
});
