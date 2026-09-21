import { lookup } from "node:dns/promises";
import http from "node:http";
import https from "node:https";
import ipaddr from "ipaddr.js";
import * as cheerio from "cheerio";
import { AppError } from "./errors";

export function isPublicAddress(address: string) {
  try {
    let parsed = ipaddr.parse(address);
    if (parsed.kind() === "ipv6" && (parsed as ipaddr.IPv6).isIPv4MappedAddress()) parsed = (parsed as ipaddr.IPv6).toIPv4Address();
    return parsed.range() === "unicast";
  } catch { return false; }
}
export async function publicTarget(input: string) {
  let url: URL;
  try { url = new URL(input); } catch { throw new AppError("Enter a complete job URL starting with https://."); }
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || (url.port && !["80", "443"].includes(url.port))) throw new AppError("Use a public HTTP or HTTPS job URL on a standard port.");
  const hostname = url.hostname.replace(/^\[|\]$/g, "");
  if (/^(localhost|.*\.localhost|.*\.local)$/i.test(hostname)) throw new AppError("Local and private-network job URLs are not allowed.");
  let addresses;
  try { addresses = await lookup(hostname, { all: true }); }
  catch { throw new AppError("That job website could not be reached. Check the URL or paste its description."); }
  if (!addresses.length || addresses.some(a => !isPublicAddress(a.address))) throw new AppError("Local and private-network job URLs are not allowed.");
  return { url, address: addresses[0] };
}

async function fetchPage(input: string, deadline: number, redirects = 0): Promise<{ html: string; url: string }> {
  if (redirects > 5 || Date.now() >= deadline) throw new AppError("The job website took too long to respond. Paste the description instead.");
  const { url, address } = await publicTarget(input);
  // Pin the validated address through connect, avoiding a second DNS lookup/rebinding.
  const response = await new Promise<{ status: number; location?: string; html: string; type: string }>((resolve, reject) => {
    const request = (url.protocol === "https:" ? https : http).request(url, {
      hostname: address.address,
      servername: url.hostname.replace(/^\[|\]$/g, ""),
      headers: { Host: url.host, "User-Agent": "ResumeRewriter/1.0 (job-description extraction)", Accept: "text/html,application/xhtml+xml", "Accept-Encoding": "identity" },
    }, res => {
      const chunks: Buffer[] = []; let size = 0;
      res.on("data", (chunk: Buffer) => { size += chunk.length; if (size > 2_000_000) request.destroy(new AppError("That job page is too large. Paste the description instead.")); else chunks.push(chunk); });
      res.on("error", reject);
      res.on("end", () => resolve({ status: res.statusCode ?? 0, location: res.headers.location, html: Buffer.concat(chunks).toString("utf8"), type: res.headers["content-type"] ?? "" }));
    });
    const timeout = setTimeout(() => request.destroy(new AppError("The job website timed out. Paste the description instead.")), Math.max(1, deadline - Date.now()));
    request.on("close", () => clearTimeout(timeout)); request.on("error", reject); request.end();
  });
  if (response.status >= 300 && response.status < 400 && response.location) return fetchPage(new URL(response.location, url).href, deadline, redirects + 1);
  if (response.status < 200 || response.status >= 300) throw new AppError("This website blocked extraction or the job is unavailable. Paste the job description instead.");
  if (!/text\/html|application\/xhtml\+xml/i.test(response.type)) throw new AppError("That link is not a job webpage. Paste the description instead.");
  return { html: response.html, url: url.href };
}

function plainHtml(html: string) {
  const $ = cheerio.load(html);
  $("script,style,noscript,nav,header,footer,svg,form").remove();
  $("br").replaceWith("\n");
  $("p,li,div,h1,h2,h3,h4,section").append("\n");
  return $.root().text().replace(/[ \t]+/g, " ").replace(/ *\n */g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}
export function extractJobHtml(html: string) {
  const $ = cheerio.load(html);
  const jobs: Record<string, unknown>[] = [];
  function visit(value: unknown) {
    if (Array.isArray(value)) return value.forEach(visit);
    if (!value || typeof value !== "object") return;
    const obj = value as Record<string, unknown>;
    if (obj["@type"] === "JobPosting" || (Array.isArray(obj["@type"]) && obj["@type"].includes("JobPosting"))) jobs.push(obj);
    if (obj["@graph"]) visit(obj["@graph"]);
  }
  $("script[type='application/ld+json']").each((_i, el) => { try { visit(JSON.parse($(el).text())); } catch { /* malformed markup */ } });
  const job = jobs.find(j => typeof j.description === "string");
  let text: string, company = "", role = "";
  if (job) {
    role = typeof job.title === "string" ? plainHtml(job.title).slice(0, 150) : "";
    const org = job.hiringOrganization as Record<string, unknown> | undefined;
    company = typeof org?.name === "string" ? plainHtml(org.name).slice(0, 150) : "";
    text = [role, company, plainHtml(job.description as string)].filter(Boolean).join("\n\n");
  } else {
    const content = $("main").first().html() || $("article").first().html() || $("body").html() || html;
    text = plainHtml(content);
  }
  if (text.length < 100 || /^(?:just a moment|access denied|verify you are human)/i.test(text)) throw new AppError("No usable job description was found. Paste the description instead.");
  return { text: text.slice(0, 40_000), company, role, truncated: text.length > 40_000 };
}
export async function extractJob(url: string) {
  try { const page = await fetchPage(url, Date.now() + 20_000); return { ...extractJobHtml(page.html), url: page.url }; }
  catch (error) { if (error instanceof AppError) throw error; throw new AppError("The job page could not be read. Paste its description instead."); }
}
