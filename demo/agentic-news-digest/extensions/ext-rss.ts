/**
 * Custom rill extension: rss
 *
 * Purpose: Fetch and parse RSS/Atom feeds into structured rill dicts.
 *
 * Mounted in rill-config.json as "./dist/extensions/ext-rss.js"
 * Used in rill scripts as: use<ext:rss> => $rss
 */

import {
  type ExtensionFactoryResult,
  type ExtensionManifest,
  type ExtensionConfigSchema,
  type RillParam,
  type RillFunction,
  type RillValue,
  type TypeStructure,
  RuntimeError,
  toCallable,
  structureToTypeValue,
} from '@rcrsr/rill';
import { XMLParser } from 'fast-xml-parser';

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

interface ExtensionConfig {
  feeds: string[];
  timeout: number;
  max_items_per_feed: number;
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Shape of a single feed item as a rill dict */
interface FeedItem {
  title: string;
  link: string;
  description: string;
  pub_date: string;
  source: string;
}

// ---------------------------------------------------------------------------
// Type structures (rill type system descriptors)
// ---------------------------------------------------------------------------

/** dict(title: string, link: string, description: string, pub_date: string, source: string) */
const ITEM_DICT_STRUCTURE: TypeStructure = {
  kind: 'dict',
  fields: {
    title: { type: { kind: 'string' } },
    link: { type: { kind: 'string' } },
    description: { type: { kind: 'string' } },
    pub_date: { type: { kind: 'string' } },
    source: { type: { kind: 'string' } },
  },
};

/** list(dict(...)) */
const ITEM_LIST_STRUCTURE: TypeStructure = {
  kind: 'list',
  element: ITEM_DICT_STRUCTURE,
};

/** list(string) */
const STRING_LIST_STRUCTURE: TypeStructure = {
  kind: 'list',
  element: { kind: 'string' },
};

// ---------------------------------------------------------------------------
// XML parser
// ---------------------------------------------------------------------------

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  htmlEntities: true,
  processEntities: false,
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Strip HTML tags, collapse whitespace, and truncate to maxLen characters. */
function cleanDescription(raw: unknown, maxLen: number = 500): string {
  if (raw == null) return '';
  const text = String(raw)
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return text.length > maxLen ? text.slice(0, maxLen) : text;
}

/** Extract hostname from a URL for the `source` field. */
function hostnameOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

/** Coerce a value that may be a single object or an array into an array. */
function toArray<T>(val: T | T[] | undefined | null): T[] {
  if (val == null) return [];
  return Array.isArray(val) ? val : [val];
}

/** Parse raw XML text into normalized FeedItem[]. */
function parseXml(xml: string, feedUrl: string, maxItems: number): FeedItem[] {
  const doc = parser.parse(xml);
  const source = hostnameOf(feedUrl);

  // Detect format: RSS or Atom
  if (doc.rss) {
    // RSS 2.0
    const items = toArray(doc.rss?.channel?.item);
    return items.slice(0, maxItems).map((item: Record<string, unknown>) => ({
      title: String(item.title ?? ''),
      link: String(item.link ?? ''),
      description: cleanDescription(item.description),
      pub_date: String(item.pubDate ?? ''),
      source,
    }));
  }

  if (doc.feed) {
    // Atom
    const entries = toArray(doc.feed?.entry);
    return entries.slice(0, maxItems).map((entry: Record<string, unknown>) => {
      // Atom link can be an object with @_href or a plain string
      let link = '';
      const rawLink = entry.link;
      if (typeof rawLink === 'string') {
        link = rawLink;
      } else if (Array.isArray(rawLink)) {
        // Pick the first alternate or the first entry
        const alt = rawLink.find(
          (l: unknown) =>
            l != null &&
            typeof l === 'object' &&
            ((l as Record<string, unknown>)['@_rel'] === 'alternate' ||
              (l as Record<string, unknown>)['@_rel'] == null)
        );
        const resolved = alt ?? rawLink[0];
        link =
          typeof resolved === 'string'
            ? resolved
            : String(
                (resolved as Record<string, unknown> | undefined)?.['@_href'] ??
                  ''
              );
      } else if (rawLink != null && typeof rawLink === 'object') {
        link = String((rawLink as Record<string, unknown>)['@_href'] ?? '');
      }

      const description =
        entry.summary ??
        entry.content ??
        (entry as Record<string, unknown>)['content:encoded'] ??
        '';

      return {
        title: String(entry.title ?? ''),
        link,
        description: cleanDescription(description),
        pub_date: String(entry.updated ?? entry.published ?? ''),
        source,
      };
    });
  }

  // Unknown format
  return [];
}

/** Sort items by pub_date descending (newest first). Unparseable dates sort last. */
function sortByDate(items: FeedItem[]): FeedItem[] {
  return items.sort((a, b) => {
    const da = new Date(a.pub_date).getTime();
    const db = new Date(b.pub_date).getTime();
    // NaN-safe: push unparseable dates to the end
    if (isNaN(da) && isNaN(db)) return 0;
    if (isNaN(da)) return 1;
    if (isNaN(db)) return -1;
    return db - da;
  });
}

/** Convert a FeedItem to a rill dict (Record<string, RillValue>). */
function itemToRillDict(item: FeedItem): Record<string, RillValue> {
  return {
    title: item.title,
    link: item.link,
    description: item.description,
    pub_date: item.pub_date,
    source: item.source,
  };
}

/** Fetch a single feed URL and return parsed items. */
async function fetchFeed(
  url: string,
  timeout: number,
  maxItems: number
): Promise<FeedItem[]> {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(timeout),
    headers: { 'User-Agent': 'rill-ext-rss/0.1.0' },
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} for ${url}`);
  }
  const xml = await response.text();
  return parseXml(xml, url, maxItems);
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

function createExtension(config: ExtensionConfig): ExtensionFactoryResult {
  // Validate config
  const feeds: string[] = Array.isArray(config.feeds) ? config.feeds : [];
  if (feeds.length === 0) {
    throw new RuntimeError(
      'RILL-R004',
      'rss: feeds list is empty; configure at least one feed URL'
    );
  }
  const timeout: number =
    typeof config.timeout === 'number' && config.timeout > 0
      ? config.timeout
      : 15000;
  const maxItems: number =
    typeof config.max_items_per_feed === 'number' &&
    config.max_items_per_feed > 0
      ? config.max_items_per_feed
      : 20;

  // -------------------------------------------------------------------------
  // fetch_all() - fetch all configured feeds in parallel
  // -------------------------------------------------------------------------
  const fetchAllDef: RillFunction = {
    params: [] as readonly RillParam[],
    fn: async (): Promise<RillValue> => {
      const results = await Promise.allSettled(
        feeds.map((url) => fetchFeed(url, timeout, maxItems))
      );

      const allItems: FeedItem[] = [];
      for (let i = 0; i < results.length; i++) {
        const result = results[i];
        if (result.status === 'fulfilled') {
          allItems.push(...result.value);
        } else {
          // Log warning and continue
          console.warn(`rss: failed to fetch ${feeds[i]}: ${result.reason}`);
        }
      }

      return sortByDate(allItems).map(itemToRillDict) as RillValue;
    },
    annotations: {
      description: 'Fetch and parse all configured RSS/Atom feeds',
    },
    returnType: structureToTypeValue(ITEM_LIST_STRUCTURE),
  };

  // -------------------------------------------------------------------------
  // fetch(url: string) - fetch a single feed URL
  // -------------------------------------------------------------------------
  const fetchOneDef: RillFunction = {
    params: [
      {
        name: 'url',
        type: { kind: 'string' } as TypeStructure,
        defaultValue: undefined,
        annotations: { description: 'RSS or Atom feed URL to fetch' },
      },
    ] as readonly RillParam[],
    fn: async (args): Promise<RillValue> => {
      const url = args.url as string;
      const items = await fetchFeed(url, timeout, maxItems);
      return sortByDate(items).map(itemToRillDict) as RillValue;
    },
    annotations: { description: 'Fetch and parse a single RSS/Atom feed URL' },
    returnType: structureToTypeValue(ITEM_LIST_STRUCTURE),
  };

  // -------------------------------------------------------------------------
  // feeds() - return the configured feed URL list
  // -------------------------------------------------------------------------
  const feedsDef: RillFunction = {
    params: [] as readonly RillParam[],
    fn: (): RillValue => {
      return [...feeds] as RillValue;
    },
    annotations: { description: 'Return the list of configured feed URLs' },
    returnType: structureToTypeValue(STRING_LIST_STRUCTURE),
  };

  // -------------------------------------------------------------------------
  // Build the extension value dict
  // -------------------------------------------------------------------------
  const value: Record<string, RillValue> = {
    fetch_all: toCallable(fetchAllDef),
    fetch: toCallable(fetchOneDef),
    feeds: toCallable(feedsDef),
  };

  return { value };
}

// ---------------------------------------------------------------------------
// Manifest
// ---------------------------------------------------------------------------

export const configSchema: ExtensionConfigSchema = {};

export const extensionManifest: ExtensionManifest = {
  factory: createExtension as ExtensionManifest['factory'],
  configSchema,
  version: '0.1.0',
};
