import { detectPlatform, type AffiliatePlatform } from "@/lib/attribution";

describe("detectPlatform", () => {
  it("detects Mavely URLs", () => {
    expect(detectPlatform("https://go.mvly.co/nicki/lululemon")).toBe("mavely");
    expect(detectPlatform("https://mavely.app.link/abc123")).toBe("mavely");
  });

  it("detects LTK URLs", () => {
    expect(detectPlatform("https://liketk.it/abc123")).toBe("ltk");
    expect(detectPlatform("https://www.ltk.com/post/xyz")).toBe("ltk");
    expect(detectPlatform("https://rstyle.me/+abc123")).toBe("ltk");
  });

  it("detects ShopMy URLs", () => {
    expect(detectPlatform("https://shopmy.us/collections/123")).toBe("shopmy");
    expect(detectPlatform("https://shop.shopmy.co/product/abc")).toBe("shopmy");
  });

  it("detects Amazon URLs", () => {
    expect(detectPlatform("https://amzn.to/abc123")).toBe("amazon");
    expect(detectPlatform("https://www.amazon.com/shop/nicki")).toBe("amazon");
    expect(detectPlatform("https://amazon.com/dp/B08ABC123")).toBe("amazon");
  });

  it("returns null for unknown URLs", () => {
    expect(detectPlatform("https://lululemon.com/product/abc")).toBeNull();
    expect(detectPlatform("")).toBeNull();
    expect(detectPlatform(null)).toBeNull();
  });

  it("handles URLs with query strings", () => {
    expect(detectPlatform("https://liketk.it/abc123?utm_source=ig")).toBe("ltk");
  });
});
