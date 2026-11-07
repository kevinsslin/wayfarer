import { describe, expect, it } from "vitest";
import { isGoogleMapsUrl, isShortMapsUrl, parseGoogleMapsUrl } from "./gmaps-url";

describe("isGoogleMapsUrl", () => {
  it("accepts share, place, search and short links", () => {
    expect(isGoogleMapsUrl("https://maps.app.goo.gl/TvPZdQo9HRmnfb4d8")).toBe(true);
    expect(isGoogleMapsUrl("https://www.google.com/maps/place/Senkoji/@34.409,133.205,17z")).toBe(true);
    expect(isGoogleMapsUrl("https://maps.google.com/maps?q=34.409,133.205")).toBe(true);
    expect(isGoogleMapsUrl("https://www.google.co.jp/maps/search/ramen")).toBe(true);
    expect(isGoogleMapsUrl("https://goo.gl/maps/Kj7yHqXhZ3s")).toBe(true);
  });
  it("rejects other links and plain text", () => {
    expect(isGoogleMapsUrl("https://www.google.com/search?q=maps")).toBe(false);
    expect(isGoogleMapsUrl("https://example.com/maps/place/x")).toBe(false);
    expect(isGoogleMapsUrl("千光寺 尾道")).toBe(false);
  });
  it("flags only short hosts as short", () => {
    expect(isShortMapsUrl("https://maps.app.goo.gl/abc")).toBe(true);
    expect(isShortMapsUrl("https://www.google.com/maps/place/x/@1,2,3z")).toBe(false);
  });
});

describe("parseGoogleMapsUrl", () => {
  it("prefers the exact !3d!4d pin over the @ viewport center", () => {
    const p = parseGoogleMapsUrl(
      "https://www.google.com/maps/place/%E5%8D%83%E5%85%89%E5%AF%BA/@34.4095,133.1999,15z/data=!4m6!3m5!1s0x355aa1b3d9f0c0a1:0x1234abcd!8m2!3d34.408912!4d133.204456!16s%2Fg%2F11c1",
    );
    expect(p).toMatchObject({ isShort: false, name: "千光寺", lat: 34.408912, lng: 133.204456, ftid: "0x355aa1b3d9f0c0a1:0x1234abcd" });
  });
  it("falls back to @lat,lng and decodes + as space", () => {
    const p = parseGoogleMapsUrl("https://www.google.com/maps/place/Senkoji+Temple/@34.409,133.205,17z");
    expect(p).toMatchObject({ name: "Senkoji Temple", lat: 34.409, lng: 133.205 });
    expect(p?.query).toBeUndefined();
  });
  it("reads coordinates out of a /maps/search/lat,+lng redirect target", () => {
    const p = parseGoogleMapsUrl("https://www.google.com/maps/search/5.811698,+-55.118891?entry=tts&g_ep=Eg");
    expect(p).toMatchObject({ lat: 5.811698, lng: -55.118891 });
    expect(p?.query).toBeUndefined();
  });
  it("reads ?q=lat,lng and ?q=text", () => {
    expect(parseGoogleMapsUrl("https://maps.google.com/maps?q=34.409,133.205")).toMatchObject({ lat: 34.409, lng: 133.205 });
    expect(parseGoogleMapsUrl("https://maps.google.com/?q=Ichiran+Ramen+Shibuya")).toMatchObject({ query: "Ichiran Ramen Shibuya" });
  });
  it("reads place ids from the Maps URLs API forms", () => {
    expect(parseGoogleMapsUrl("https://www.google.com/maps/search/?api=1&query=Sydney&query_place_id=ChIJN1t_tDeuEmsRUsoyG83frY4")).toMatchObject({
      placeId: "ChIJN1t_tDeuEmsRUsoyG83frY4",
      query: "Sydney",
    });
    const p = parseGoogleMapsUrl("https://www.google.com/maps/place/?q=place_id:ChIJN1t_tDeuEmsRUsoyG83frY4");
    expect(p).toMatchObject({ placeId: "ChIJN1t_tDeuEmsRUsoyG83frY4" });
    expect(p?.query).toBeUndefined();
  });
  it("converts a decimal cid to the hex ftid form", () => {
    expect(parseGoogleMapsUrl("https://maps.google.com/?cid=1311573591437522932")?.ftid).toBe("0x0:0x1233a53b7e6ab7f4");
  });
  it("drops out-of-range coordinates", () => {
    const p = parseGoogleMapsUrl("https://www.google.com/maps/place/x/@134.0,233.0,3z");
    expect(p?.lat).toBeUndefined();
  });
  it("marks short links and returns null for non-maps", () => {
    expect(parseGoogleMapsUrl("https://maps.app.goo.gl/abc")).toEqual({ isShort: true });
    expect(parseGoogleMapsUrl("https://example.com")).toBeNull();
    expect(parseGoogleMapsUrl("not a url at all !!")).toBeNull();
  });
});


import { mapsUrlFromHtml } from "./gmaps-url";

describe("short-link response URLs", () => {
  it("reads a canonical place URL without executing page code", () => {
    const url = "https://www.google.com/maps/place/Cafe/@35,139,17z/data=!3d35!4d139";
    expect(mapsUrlFromHtml(`<link rel="canonical" href="${url}"><script>throw new Error('never execute')</script>`)).toBe(url);
  });
  it("reads Google's escaped continuation URL after redirects", () => {
    const html = String.raw`<script>var data="https:\/\/accounts.google.com/Login?continue=https://www.google.com/maps/search/5.811698,%2B-55.118891%3Fentry%3Dtts\u0026amp;service\u003dlocal"</script>`;
    const result = parseGoogleMapsUrl(mapsUrlFromHtml(html)!);
    expect(result).toMatchObject({ lat: 5.811698, lng: -55.118891, exact: true });
  });
  it("ignores external destinations, static map images and pages without a place", () => {
    expect(mapsUrlFromHtml('<a href="https://example.com/maps/place/Fake/@1,2">x</a>')).toBeNull();
    expect(mapsUrlFromHtml('<img src="https://maps.google.com/maps/api/staticmap?center=1,2">')).toBeNull();
    expect(mapsUrlFromHtml("Google requires consent")).toBeNull();
  });
  it("prefers the exact place pin over a viewport-only URL", () => {
    const exact = "https://www.google.com/maps/place/Cafe/data=!3d35!4d139";
    const html = `"https://www.google.com/maps/place/Cafe/@30,130,10z" "${exact}"`;
    expect(mapsUrlFromHtml(html)).toBe(exact);
  });
});
