import { describe, expect, it } from "vitest";
import { extractJobHtml, isPublicAddress, publicTarget } from "../lib/jobs";
import { guardLocal } from "../lib/api";
const description = "Build reliable software with TypeScript and React. Work with product teams to ship useful features, write tests, review code, and maintain web applications.";
describe("job extraction", () => {
  it("prefers structured JobPosting over page chrome", () => {
    const html = `<html><script type="application/ld+json">${JSON.stringify({ "@graph": [{ "@type": "JobPosting", title: "Engineer", hiringOrganization: { name: "Example" }, description: `<p>${description}</p>` }] })}</script><body><nav>Wrong text</nav>Other page</body></html>`;
    const result = extractJobHtml(html); expect(result.company).toBe("Example"); expect(result.role).toBe("Engineer"); expect(result.text).toContain(description); expect(result.text).not.toContain("Wrong text");
  });
  it("falls back to readable main content and strips scripts", () => { const result = extractJobHtml(`<nav>Navigation</nav><main><h1>Engineer</h1><p>${description}</p><script>malicious()</script></main>`); expect(result.text).toContain(description); expect(result.text).not.toContain("Navigation"); expect(result.text).not.toContain("malicious"); });
  it("rejects empty and blocked pages", () => { expect(() => extractJobHtml("<p>Access denied</p>")).toThrow(/No usable/); });
});
describe("network boundaries", () => {
  it("accepts the validated browser host when Next normalizes request.url", () => {
    expect(() => guardLocal(new Request("http://localhost:3000/api/compile", { headers: { host: "127.0.0.1:3000", origin: "http://127.0.0.1:3000" } }))).not.toThrow();
  });
  it.each(["127.0.0.1", "0.0.0.0", "10.1.2.3", "192.168.1.2", "172.16.0.1", "169.254.169.254", "100.64.1.1", "224.0.0.1", "::1", "::ffff:127.0.0.1", "fc00::1", "fe80::1", "::"])('blocks private/special address %s', address => { expect(isPublicAddress(address)).toBe(false); });
  it.each(["8.8.8.8", "1.1.1.1", "2606:4700:4700::1111"])('accepts public address %s', address => { expect(isPublicAddress(address)).toBe(true); });
  it.each(["http://localhost/x", "http://thing.local/x", "file:///etc/passwd", "http://user:password@example.com", "https://example.com:8080"])('rejects unsafe URL %s', async url => { await expect(publicTarget(url)).rejects.toThrow(); });
  it("rejects cross-origin/cross-site writes", () => { expect(() => guardLocal(new Request("http://127.0.0.1:3000/api/rewrite", { headers: { origin: "https://evil.test" } }))).toThrow(/Cross-origin/); expect(() => guardLocal(new Request("http://attacker.test/api/state"))).toThrow(/localhost/); });
});
