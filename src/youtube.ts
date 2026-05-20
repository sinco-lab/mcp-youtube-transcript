import { McpError, ErrorCode } from "@modelcontextprotocol/sdk/types.js";

// Types
export interface Transcript {
  text: string;
  lang?: string;
  timestamp: number;
  duration: number;
}

export interface TranscriptOptions {
  videoID: string;
  lang?: string;
}

export interface CaptionLanguage {
  languageCode: string;
  name: string;
  isGenerated: boolean;
  source: "innertube" | "web";
}

interface CaptionTrack {
  languageCode: string;
  baseUrl: string;
  kind?: string;
  name?: {
    simpleText?: string;
    runs?: Array<{ text?: string }>;
  };
}

interface TranscriptFetchResult {
  baseUrl: string;
  languageCode: string;
  source: "innertube" | "web";
  transcripts: Transcript[];
}

// Constants
const USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36";
const WEB_TRANSCRIPT_USER_AGENT = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_4) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/85.0.4183.83 Safari/537.36,gzip(gfe)";
const ADDITIONAL_HEADERS: Record<string, string> = {
  "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9"
};

const INNERTUBE_CLIENT_VERSION = "20.10.38";
const INNERTUBE_PLAYER_API_URL = "https://www.youtube.com/youtubei/v1/player?prettyPrint=false";
const INNERTUBE_CONTEXT = {
  client: {
    clientName: "ANDROID",
    clientVersion: INNERTUBE_CLIENT_VERSION
  }
};
const INNERTUBE_USER_AGENT = `com.google.android.youtube/${INNERTUBE_CLIENT_VERSION} (Linux; U; Android 14)`;

const MAX_RETRIES = 3;
const RETRY_DELAY = 1000;

// Error handling
export class YouTubeTranscriptError extends McpError {
  constructor(message: string) {
    super(ErrorCode.InternalError, message);
    this.name = "YouTubeTranscriptError";
  }
}

// Utility functions
export class YouTubeUtils {
  /**
   * Format time (convert seconds to readable format)
   */
  static formatTime(seconds: number): string {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);
    const ms = Math.floor((seconds % 1) * 1000);

    return `${hours.toString().padStart(2, "0")}:${minutes.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}.${ms.toString().padStart(3, "0")}`;
  }

  /**
   * Calculate total duration in seconds
   */
  static calculateTotalDuration(items: Transcript[]): number {
    return items.reduce((acc, item) => Math.max(acc, item.timestamp + item.duration), 0);
  }

  /**
   * Decode HTML entities
   */
  static decodeHTML(text: string): string {
    const entities: Record<string, string> = {
      "&amp;": "&",
      "&lt;": "<",
      "&gt;": ">",
      "&quot;": "\"",
      "&#39;": "'",
      "&apos;": "'",
      "&#x27;": "'",
      "&#x2F;": "/",
      "&#x2f;": "/",
      "&#47;": "/",
      "&#xa0;": " ",
      "&nbsp;": " "
    };

    return text
      .replace(/&#x([0-9a-fA-F]+);/g, (_, hex: string) => this.safeCodePoint(parseInt(hex, 16)))
      .replace(/&#(\d+);/g, (_, dec: string) => this.safeCodePoint(parseInt(dec, 10)))
      .replace(/&[^;]+;/g, match => entities[match] || match)
      .trim();
  }

  /**
   * Parse YouTube transcript payloads in json3, srv3/XML, classic XML, and VTT formats.
   */
  static parseTranscriptBody(body: string, lang?: string): Transcript[] {
    const trimmed = body.trim();
    if (!trimmed) {
      return [];
    }

    if (trimmed.startsWith("{")) {
      return this.parseJson3Transcript(trimmed, lang);
    }

    if (trimmed.startsWith("WEBVTT")) {
      return this.parseVttTranscript(trimmed, lang);
    }

    return this.parseXmlTranscript(trimmed, lang);
  }

  /**
   * Normalize text formatting (punctuation and spaces)
   */
  static normalizeText(text: string): string {
    return text
      .replace(/\n/g, " ")
      .replace(/\s*\.\s*\.\s*/g, ". ")
      .replace(/\s*\.\s+/g, ". ")
      .replace(/\s+/g, " ")
      .replace(/\s+([,.])/g, "$1")
      .replace(/\s*\?\s*/g, "? ")
      .replace(/\s*!\s*/g, "! ")
      .trim();
  }

  /**
   * Format transcript text with optional paragraph breaks
   */
  static formatTranscriptText(
    transcripts: Transcript[],
    options: {
      enableParagraphs?: boolean;
      timeGapThreshold?: number;
      maxSentencesPerParagraph?: number;
    } = {}
  ): string {
    const {
      enableParagraphs = false,
      timeGapThreshold = 2,
      maxSentencesPerParagraph = 5
    } = options;

    const processedTranscripts = transcripts
      .map(transcript => this.decodeHTML(transcript.text))
      .filter(text => text.length > 0);

    if (!enableParagraphs) {
      return this.normalizeText(processedTranscripts.join(" "));
    }

    const paragraphs: string[] = [];
    let currentParagraph: string[] = [];
    let lastEndTime = 0;

    for (const transcript of transcripts) {
      const text = this.decodeHTML(transcript.text.trim());
      if (!text) continue;

      const timeGap = transcript.timestamp - lastEndTime;
      const previousText = currentParagraph[currentParagraph.length - 1] || "";

      const shouldStartNewParagraph =
        timeGap > timeGapThreshold ||
        (previousText.endsWith(".") && /^[A-Z]/.test(text)) ||
        currentParagraph.length >= maxSentencesPerParagraph;

      if (shouldStartNewParagraph && currentParagraph.length > 0) {
        paragraphs.push(this.normalizeText(currentParagraph.join(" ")));
        currentParagraph = [];
      }

      currentParagraph.push(text);
      lastEndTime = transcript.timestamp + transcript.duration;
    }

    if (currentParagraph.length > 0) {
      paragraphs.push(this.normalizeText(currentParagraph.join(" ")));
    }

    return paragraphs.join("\n\n");
  }

  static formatTimedTranscriptText(transcripts: Transcript[]): string {
    return transcripts
      .map(transcript => {
        const text = this.normalizeText(this.decodeHTML(transcript.text));
        return text ? `[${this.formatTime(transcript.timestamp)}] ${text}` : "";
      })
      .filter(Boolean)
      .join("\n");
  }

  private static parseJson3Transcript(json: string, lang?: string): Transcript[] {
    try {
      const data = JSON.parse(json) as {
        events?: Array<{
          tStartMs?: number;
          dDurationMs?: number;
          segs?: Array<{ utf8?: string }>;
        }>;
      };

      if (!Array.isArray(data.events)) {
        return [];
      }

      return data.events.reduce<Transcript[]>((items, event) => {
        const text = event.segs
          ?.map(segment => segment.utf8 || "")
          .join("")
          .replace(/\s+/g, " ")
          .trim();

        if (text) {
          items.push({
            text: this.decodeHTML(text),
            lang,
            timestamp: (event.tStartMs || 0) / 1000,
            duration: (event.dDurationMs || 0) / 1000
          });
        }

        return items;
      }, []);
    } catch {
      return [];
    }
  }

  private static parseXmlTranscript(xml: string, lang?: string): Transcript[] {
    const srv3Results = this.parseSrv3Transcript(xml, lang);
    if (srv3Results.length > 0) {
      return srv3Results;
    }

    const classicResults: Transcript[] = [];
    const textRegex = /<text\b([^>]*)>([\s\S]*?)<\/text>/g;
    let match: RegExpExecArray | null;

    while ((match = textRegex.exec(xml)) !== null) {
      const attributes = this.parseAttributes(match[1]);
      const start = Number.parseFloat(attributes.start || "0");
      const duration = Number.parseFloat(attributes.dur || "0");
      const text = this.decodeHTML(this.stripTranscriptTags(match[2]));

      if (text) {
        classicResults.push({
          text,
          lang,
          timestamp: start,
          duration
        });
      }
    }

    return classicResults;
  }

  private static parseSrv3Transcript(xml: string, lang?: string): Transcript[] {
    const results: Transcript[] = [];
    const pRegex = /<p\b([^>]*)>([\s\S]*?)<\/p>/g;
    let match: RegExpExecArray | null;

    while ((match = pRegex.exec(xml)) !== null) {
      const attributes = this.parseAttributes(match[1]);
      const startMs = Number.parseInt(attributes.t || "0", 10);
      const durationMs = Number.parseInt(attributes.d || "0", 10);
      const text = this.decodeHTML(this.stripTranscriptTags(match[2]));

      if (text) {
        results.push({
          text,
          lang,
          timestamp: startMs / 1000,
          duration: durationMs / 1000
        });
      }
    }

    return results;
  }

  private static parseVttTranscript(vtt: string, lang?: string): Transcript[] {
    const results: Transcript[] = [];
    const lines = vtt.replace(/\r/g, "").split("\n");

    for (let i = 0; i < lines.length; i++) {
      const timingLine = lines[i];
      if (!timingLine.includes("-->")) {
        continue;
      }

      const [startRaw, endRaw] = timingLine.split("-->").map(part => part.trim().split(/\s+/)[0]);
      const start = this.parseVttTimestamp(startRaw);
      const end = this.parseVttTimestamp(endRaw);
      const textLines: string[] = [];

      i++;
      while (i < lines.length && lines[i].trim() !== "") {
        textLines.push(lines[i]);
        i++;
      }

      const text = this.decodeHTML(this.stripTranscriptTags(textLines.join(" ")));
      if (text) {
        results.push({
          text,
          lang,
          timestamp: start,
          duration: Math.max(0, end - start)
        });
      }
    }

    return results;
  }

  private static parseVttTimestamp(value: string): number {
    const parts = value.split(":");
    const seconds = Number.parseFloat(parts.pop() || "0");
    const minutes = Number.parseFloat(parts.pop() || "0");
    const hours = Number.parseFloat(parts.pop() || "0");

    return hours * 3600 + minutes * 60 + seconds;
  }

  private static parseAttributes(rawAttributes: string): Record<string, string> {
    const attributes: Record<string, string> = {};
    const regex = /([:\w-]+)="([^"]*)"/g;
    let match: RegExpExecArray | null;

    while ((match = regex.exec(rawAttributes)) !== null) {
      attributes[match[1]] = match[2];
    }

    return attributes;
  }

  private static stripTranscriptTags(text: string): string {
    return text
      .replace(/<br\s*\/?>/gi, " ")
      .replace(/<\/s>\s*<s\b[^>]*>/gi, "")
      .replace(/<[^>]+>/g, "")
      .replace(/\s+/g, " ")
      .trim();
  }

  private static safeCodePoint(codePoint: number): string {
    try {
      return String.fromCodePoint(codePoint);
    } catch {
      return "";
    }
  }
}

const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

const isRateLimitError = (html: string): boolean => {
  return html.includes("class=\"g-recaptcha\"") ||
         html.includes("sorry/index") ||
         html.includes("consent.youtube.com");
};

// Main YouTube functionality
export class YouTubeTranscriptFetcher {
  /**
   * Fetch video title using oEmbed API
   */
  private static async fetchVideoTitle(videoId: string): Promise<string> {
    try {
      const response = await fetch(
        `https://www.youtube.com/oembed?url=http://www.youtube.com/watch?v=${videoId}&format=json`
      );
      if (!response.ok) {
        throw new Error(`Failed to fetch video title (HTTP ${response.status})`);
      }
      const data = await response.json() as { title?: string };
      return YouTubeUtils.decodeHTML(data.title || "Untitled Video");
    } catch (error) {
      console.error(`Failed to fetch video title: ${error}`);
      return "Untitled Video";
    }
  }

  private static async fetchWithRetry(
    url: string,
    options: RequestInit,
    retries = MAX_RETRIES
  ): Promise<Response> {
    try {
      const response = await fetch(url, options);
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      return response;
    } catch (error) {
      if (retries > 0) {
        console.warn(`Fetch failed, retrying... (${retries} attempts left)`);
        await delay(RETRY_DELAY);
        return this.fetchWithRetry(url, options, retries - 1);
      }
      throw error;
    }
  }

  /**
   * Fetch transcript configuration and content from YouTube.
   */
  private static async fetchTranscriptConfigAndContent(videoId: string, lang?: string): Promise<TranscriptFetchResult> {
    const fallbackErrors: string[] = [];

    try {
      const innerTubeResult = await this.fetchTranscriptConfigViaInnerTube(videoId, lang);
      if (innerTubeResult && innerTubeResult.transcripts.length > 0) {
        return innerTubeResult;
      }
    } catch (error) {
      if (this.isLanguageUnavailableError(error)) {
        throw error;
      }
      fallbackErrors.push(`InnerTube: ${(error as Error).message}`);
    }

    try {
      return await this.fetchTranscriptConfigViaWeb(videoId, lang);
    } catch (error) {
      if (fallbackErrors.length === 0) {
        throw error;
      }

      throw new YouTubeTranscriptError(
        `${(error as Error).message}\nFallback attempts: ${fallbackErrors.join(" | ")}`
      );
    }
  }

  private static async fetchCaptionTracks(videoId: string): Promise<{ tracks: CaptionTrack[], source: "innertube" | "web" }> {
    const fallbackErrors: string[] = [];

    try {
      const tracks = await this.fetchCaptionTracksViaInnerTube(videoId);
      if (tracks && tracks.length > 0) {
        return { tracks, source: "innertube" };
      }
    } catch (error) {
      fallbackErrors.push(`InnerTube: ${(error as Error).message}`);
    }

    try {
      const tracks = await this.fetchCaptionTracksViaWeb(videoId);
      return { tracks, source: "web" };
    } catch (error) {
      if (fallbackErrors.length === 0) {
        throw error;
      }

      throw new YouTubeTranscriptError(
        `${(error as Error).message}\nFallback attempts: ${fallbackErrors.join(" | ")}`
      );
    }
  }

  /**
   * Fetch caption tracks from Android InnerTube first. The web caption URL can now
   * return HTTP 200 with an empty body, while the Android player response still
   * exposes usable timedtext URLs for many public videos.
   */
  private static async fetchTranscriptConfigViaInnerTube(videoId: string, lang?: string): Promise<TranscriptFetchResult | undefined> {
    const tracks = await this.fetchCaptionTracksViaInnerTube(videoId);
    if (!tracks || tracks.length === 0) {
      return undefined;
    }

    return this.fetchTranscriptFromTracks(tracks, videoId, lang, "innertube");
  }

  private static async fetchCaptionTracksViaInnerTube(videoId: string): Promise<CaptionTrack[] | undefined> {
    const response = await this.fetchWithRetry(INNERTUBE_PLAYER_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": INNERTUBE_USER_AGENT
      },
      body: JSON.stringify({
        context: INNERTUBE_CONTEXT,
        videoId
      })
    });

    const data = await response.json() as {
      playabilityStatus?: { status?: string; reason?: string };
      captions?: {
        playerCaptionsTracklistRenderer?: {
          captionTracks?: CaptionTrack[];
        };
      };
    };

    if (data.playabilityStatus?.status && data.playabilityStatus.status !== "OK") {
      throw new YouTubeTranscriptError(
        `Video ${videoId} is unavailable: ${data.playabilityStatus.reason || data.playabilityStatus.status}`
      );
    }

    const tracks = data.captions?.playerCaptionsTracklistRenderer?.captionTracks;
    if (!Array.isArray(tracks) || tracks.length === 0) {
      return undefined;
    }

    return tracks;
  }

  /**
   * Fetch caption tracks from the YouTube watch page as a fallback.
   */
  private static async fetchTranscriptConfigViaWeb(videoId: string, lang?: string): Promise<TranscriptFetchResult> {
    const tracks = await this.fetchCaptionTracksViaWeb(videoId, lang);
    return this.fetchTranscriptFromTracks(tracks, videoId, lang, "web");
  }

  private static async fetchCaptionTracksViaWeb(videoId: string, lang?: string): Promise<CaptionTrack[]> {
    const headers: Record<string, string> = {
      ...ADDITIONAL_HEADERS,
      "User-Agent": USER_AGENT
    };

    if (lang) {
      headers["Accept-Language"] = lang;
    }

    const response = await this.fetchWithRetry(`https://www.youtube.com/watch?v=${videoId}`, { headers });
    const html = await response.text();

    if (isRateLimitError(html)) {
      throw new YouTubeTranscriptError(
        "YouTube rate limit detected. This could be due to:\n" +
        "1. Too many requests from your IP\n" +
        "2. YouTube requiring CAPTCHA verification\n" +
        "3. Regional restrictions\n" +
        "Try:\n" +
        "- Waiting a few minutes\n" +
        "- Using a different IP address\n" +
        "- Using a VPN service"
      );
    }

    if (process.env.NODE_ENV === "development") {
      console.debug("YouTube response length:", html.length);
      console.debug("Contains captions:", html.includes("\"captions\":"));
    }

    const tracks = this.extractCaptionTracksFromHtml(html);
    if (!tracks || tracks.length === 0) {
      if (!html.includes("\"playabilityStatus\":")) {
        throw new YouTubeTranscriptError(`Video ${videoId} is unavailable`);
      }
      throw new YouTubeTranscriptError(`No transcripts available for video ${videoId}. Response size: ${html.length}`);
    }

    return tracks;
  }

  /**
   * Helper method to fetch transcript content.
   */
  private static async fetchTranscriptFromTracks(
    tracks: CaptionTrack[],
    videoId: string,
    lang: string | undefined,
    source: "innertube" | "web"
  ): Promise<TranscriptFetchResult> {
    const selectedTrack = this.selectCaptionTrack(tracks, videoId, lang);
    const headers: Record<string, string> = {
      ...ADDITIONAL_HEADERS,
      "User-Agent": WEB_TRANSCRIPT_USER_AGENT,
      "Referer": "https://www.youtube.com/",
      "Origin": "https://www.youtube.com"
    };

    if (lang) {
      headers["Accept-Language"] = lang;
    }

    const urls = this.buildTranscriptUrls(selectedTrack.baseUrl);
    const parseFailures: string[] = [];
    let sawEmptyBody = false;

    for (const url of urls) {
      try {
        const response = await this.fetchWithRetry(url, { headers });
        const body = await response.text();
        const parsed = YouTubeUtils.parseTranscriptBody(body, selectedTrack.languageCode);

        if (parsed.length > 0) {
          return {
            baseUrl: url,
            languageCode: selectedTrack.languageCode,
            source,
            transcripts: parsed.sort((a, b) => a.timestamp - b.timestamp)
          };
        }

        if (body.trim().length === 0) {
          sawEmptyBody = true;
        } else {
          parseFailures.push(`${this.describeTranscriptUrl(url)} returned ${body.length} chars but no parsable captions`);
        }
      } catch (error) {
        parseFailures.push(`${this.describeTranscriptUrl(url)} failed: ${(error as Error).message}`);
      }
    }

    const availableLangs = this.formatAvailableLanguages(tracks);
    const emptyBodyHint = sawEmptyBody
      ? "YouTube returned an empty caption body, which often means the selected client was rejected by YouTube's transcript endpoint."
      : "No supported transcript payload could be parsed.";

    throw new YouTubeTranscriptError(
      `No transcripts found for video ${videoId} using ${source} caption tracks. ${emptyBodyHint}\n` +
      `Requested language: ${lang || "best available"}; available languages: ${availableLangs || "unknown"}.\n` +
      `Attempts: ${parseFailures.join(" | ") || "empty caption response"}`
    );
  }

  private static selectCaptionTrack(tracks: CaptionTrack[], videoId: string, lang?: string): CaptionTrack {
    if (lang && !tracks.some(track => track.languageCode === lang)) {
      throw new YouTubeTranscriptError(
        `Language ${lang} not available for video ${videoId}. Available languages: ${this.formatAvailableLanguages(tracks)}`
      );
    }

    const candidates = lang
      ? tracks.filter(track => track.languageCode === lang)
      : tracks;

    const manualTrack = candidates.find(track => track.kind !== "asr");
    const selectedTrack = manualTrack || candidates[0];

    if (!selectedTrack?.baseUrl) {
      throw new YouTubeTranscriptError(`Could not find transcript track for video ${videoId}`);
    }

    this.assertTrustedTranscriptUrl(selectedTrack.baseUrl, videoId);
    return selectedTrack;
  }

  private static buildTranscriptUrls(baseUrl: string): string[] {
    const urls = [baseUrl];
    for (const format of ["json3", "srv3", "vtt"]) {
      const url = new URL(baseUrl);
      url.searchParams.set("fmt", format);
      urls.push(url.toString());
    }

    return [...new Set(urls)];
  }

  private static assertTrustedTranscriptUrl(rawUrl: string, videoId: string): void {
    try {
      const url = new URL(rawUrl);
      const hostname = url.hostname.toLowerCase();
      const isTrustedHost = hostname === "youtube.com" || hostname.endsWith(".youtube.com");
      if (!isTrustedHost) {
        throw new YouTubeTranscriptError(`Untrusted transcript URL host for video ${videoId}: ${url.hostname}`);
      }
    } catch (error) {
      if (error instanceof YouTubeTranscriptError) {
        throw error;
      }
      throw new YouTubeTranscriptError(`Invalid transcript URL for video ${videoId}`);
    }
  }

  private static describeTranscriptUrl(rawUrl: string): string {
    try {
      const url = new URL(rawUrl);
      return `fmt=${url.searchParams.get("fmt") || "default"}`;
    } catch {
      return "transcript URL";
    }
  }

  private static formatAvailableLanguages(tracks: CaptionTrack[]): string {
    return [...new Set(tracks.map(track => track.languageCode).filter(Boolean))].join(", ");
  }

  private static getCaptionTrackName(track: CaptionTrack): string {
    const simpleText = track.name?.simpleText;
    const runsText = track.name?.runs
      ?.map(run => run.text || "")
      .join("")
      .trim();

    return simpleText || runsText || track.languageCode;
  }

  private static mapCaptionLanguages(
    tracks: CaptionTrack[],
    source: "innertube" | "web"
  ): CaptionLanguage[] {
    const languages = new Map<string, CaptionLanguage>();

    for (const track of tracks) {
      const languageCode = track.languageCode;
      if (!languageCode) {
        continue;
      }

      const item = {
        languageCode,
        name: this.getCaptionTrackName(track),
        isGenerated: track.kind === "asr",
        source
      };
      const existing = languages.get(languageCode);

      if (!existing || (existing.isGenerated && !item.isGenerated)) {
        languages.set(languageCode, item);
      }
    }

    return [...languages.values()].sort((a, b) => a.languageCode.localeCompare(b.languageCode));
  }

  private static extractCaptionTracksFromHtml(html: string): CaptionTrack[] | undefined {
    const playerResponse = this.parseInlineJson(html, "ytInitialPlayerResponse") as {
      captions?: {
        playerCaptionsTracklistRenderer?: {
          captionTracks?: CaptionTrack[];
        };
      };
    } | null;

    const inlineTracks = playerResponse?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
    if (Array.isArray(inlineTracks) && inlineTracks.length > 0) {
      return inlineTracks;
    }

    const splitHtml = html.split("\"captions\":");
    if (splitHtml.length <= 1) {
      return undefined;
    }

    try {
      const transcriptData = JSON.parse(splitHtml[1].split(",\"videoDetails")[0].replace("\n", ""));
      const tracks = transcriptData?.playerCaptionsTracklistRenderer?.captionTracks;
      return Array.isArray(tracks) ? tracks : undefined;
    } catch {
      return undefined;
    }
  }

  private static parseInlineJson(html: string, globalName: string): unknown | null {
    const tokens = [
      `var ${globalName} =`,
      `window["${globalName}"] =`,
      `window.${globalName} =`,
      `${globalName} =`
    ];

    for (const token of tokens) {
      const tokenIndex = html.indexOf(token);
      if (tokenIndex === -1) {
        continue;
      }

      let jsonStart = tokenIndex + token.length;
      while (jsonStart < html.length && html[jsonStart] !== "{") {
        jsonStart++;
      }

      const parsed = this.parseJsonObjectAt(html, jsonStart);
      if (parsed) {
        return parsed;
      }
    }

    return null;
  }

  private static parseJsonObjectAt(text: string, startIndex: number): unknown | null {
    if (text[startIndex] !== "{") {
      return null;
    }

    let depth = 0;
    let inString = false;
    let escaped = false;

    for (let i = startIndex; i < text.length; i++) {
      const char = text[i];

      if (inString) {
        if (escaped) {
          escaped = false;
        } else if (char === "\\") {
          escaped = true;
        } else if (char === "\"") {
          inString = false;
        }
        continue;
      }

      if (char === "\"") {
        inString = true;
      } else if (char === "{") {
        depth++;
      } else if (char === "}") {
        depth--;
        if (depth === 0) {
          try {
            return JSON.parse(text.slice(startIndex, i + 1));
          } catch {
            return null;
          }
        }
      }
    }

    return null;
  }

  private static isLanguageUnavailableError(error: unknown): boolean {
    return error instanceof YouTubeTranscriptError && error.message.includes("Language ") && error.message.includes(" not available ");
  }

  /**
   * Extract video ID from YouTube URL or direct ID input
   */
  static extractVideoId(input: string): string {
    if (!input) {
      throw new McpError(
        ErrorCode.InvalidParams,
        "YouTube URL or ID is required"
      );
    }

    const normalizedInput = input.trim();

    if (/^[a-zA-Z0-9_-]{11}$/.test(normalizedInput)) {
      return normalizedInput;
    }

    try {
      const url = new URL(normalizedInput);
      const hostname = url.hostname.replace(/^www\./, "");

      if (hostname === "youtu.be") {
        const videoId = url.pathname.split("/").filter(Boolean)[0];
        if (/^[a-zA-Z0-9_-]{11}$/.test(videoId)) {
          return videoId;
        }
      } else if (hostname.endsWith("youtube.com")) {
        const pathParts = url.pathname.split("/").filter(Boolean);
        const pathVideoId = ["shorts", "embed", "v", "live"].includes(pathParts[0])
          ? pathParts[1]
          : undefined;

        if (/^[a-zA-Z0-9_-]{11}$/.test(pathVideoId || "")) {
          return pathVideoId as string;
        }

        const videoId = url.searchParams.get("v");
        if (/^[a-zA-Z0-9_-]{11}$/.test(videoId || "")) {
          return videoId as string;
        }

        throw new McpError(
          ErrorCode.InvalidParams,
          `Invalid YouTube URL: ${input}`
        );
      }
    } catch (error) {
      if (error instanceof McpError) {
        throw error;
      }

      const match = normalizedInput.match(/(?:youtube\.com\/(?:[^/]+\/.+\/|(?:v|e(?:mbed)?)\/|shorts\/|live\/|.*[?&]v=)|youtu\.be\/)([^"&?/\s]{11})/i);
      if (match) {
        return match[1];
      }
    }

    throw new McpError(
      ErrorCode.InvalidParams,
      `Could not extract video ID from: ${input}`
    );
  }

  /**
   * Fetch transcripts and video information
   */
  static async fetchTranscripts(videoId: string, config?: { lang?: string }): Promise<{ transcripts: Transcript[], title: string, language: string, source: string }> {
    try {
      const identifier = this.extractVideoId(videoId);
      const [transcriptResult, title] = await Promise.all([
        this.fetchTranscriptConfigAndContent(identifier, config?.lang),
        this.fetchVideoTitle(identifier)
      ]);

      return {
        transcripts: transcriptResult.transcripts,
        title,
        language: transcriptResult.languageCode,
        source: transcriptResult.source
      };
    } catch (error) {
      if (error instanceof YouTubeTranscriptError || error instanceof McpError) {
        throw error;
      }
      throw new YouTubeTranscriptError(`Failed to fetch transcripts: ${(error as Error).message}`);
    }
  }

  static async fetchAvailableLanguages(videoId: string): Promise<{ videoId: string, languages: CaptionLanguage[], source: string }> {
    try {
      const identifier = this.extractVideoId(videoId);
      const { tracks, source } = await this.fetchCaptionTracks(identifier);

      return {
        videoId: identifier,
        languages: this.mapCaptionLanguages(tracks, source),
        source
      };
    } catch (error) {
      if (error instanceof YouTubeTranscriptError || error instanceof McpError) {
        throw error;
      }
      throw new YouTubeTranscriptError(`Failed to fetch available languages: ${(error as Error).message}`);
    }
  }

  static async fetchVideoInfo(videoId: string): Promise<{
    videoId: string;
    title: string;
    availableLanguages: CaptionLanguage[];
    source?: string;
    transcriptWarning?: string;
  }> {
    const identifier = this.extractVideoId(videoId);
    const title = await this.fetchVideoTitle(identifier);

    try {
      const { languages, source } = await this.fetchAvailableLanguages(identifier);
      return {
        videoId: identifier,
        title,
        availableLanguages: languages,
        source
      };
    } catch (error) {
      return {
        videoId: identifier,
        title,
        availableLanguages: [],
        transcriptWarning: (error as Error).message
      };
    }
  }
}
