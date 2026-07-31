import fetch from "node-fetch";
import { retry, sleep } from "../utils/helpers.js";
import { getConfig } from "../config/index.js";

const PER_PAGE = 100;
const DELAY_MS = 300;


async function fetchWP(type, page, companyName) {
  try {
    const baseUrl = getConfig(companyName).BASE_URL;
    return await retry(async () => {
      const url = `${baseUrl}/wp-json/wp/v2/${type}?per_page=${PER_PAGE}&page=${page}`;
      console.log(url);

      console.log(`Fetching ${type} page ${page}...`);

      const res = await fetch(url, {
        headers: { "User-Agent": "RAG-Ingestion-Bot" },
      });

      // Fix #8: use X-WP-TotalPages header for reliable pagination termination
      const totalPages = parseInt(res.headers.get("X-WP-TotalPages") || "1", 10);

      if (!res.ok) {
        // Still handle 400 gracefully as a fallback
        if (res.status === 400) return null;
        throw new Error(`HTTP ${res.status}`);
      }

      const data = await res.json();

      await sleep(DELAY_MS);

      // Signal end of pages clearly
      if (page >= totalPages) return data.length > 0 ? data : null;

      return data;
    });
  } catch (err) {
    console.error("❌ Final failure:", err.message);
    return null;
  }
}


export async function fetchPage(page, companyName) {
  return fetchWP("pages", page, companyName);
}

export async function fetchPost(page, companyName) {
  return fetchWP("posts", page, companyName);
}
