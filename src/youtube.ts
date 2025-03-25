import { McpError, ErrorCode } from "@modelcontextprotocol/sdk/types.js";

// Types
export interface Transcript {
  text: string;     // Transcript text
  lang?: string;    // Language code
  timestamp: number; // Start time in seconds
  duration: number;  // Duration in seconds
}

export interface TranscriptOptions {
  videoID: string;  // Video ID or URL
  lang?: string;    // Language code, default 'en'
}

// Constants
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36';

// Error handling
export class YouTubeTranscriptError extends McpError {
  constructor(message: string) {
    super(ErrorCode.InternalError, message);
    this.name = 'YouTubeTranscriptError';
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

    return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}.${ms.toString().padStart(3, '0')}`;
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
    const entities: { [key: string]: string } = {
      '&amp;': '&',
      '&lt;': '<',
      '&gt;': '>',
      '&quot;': '"',
      '&#39;': "'",
      '&apos;': "'",
      '&#x27;': "'",
      '&#x2F;': '/',
      '&#x2f;': '/',
      '&#47;': '/',
      '&#xa0;': ' ',
      '&nbsp;': ' '
    };

    return text.replace(/&[^;]+;/g, match => entities[match] || match).trim();
  }

  /**
   * Normalize text formatting (punctuation and spaces)
   */
  static normalizeText(text: string): string {
    return text
      .replace(/\n/g, ' ')
      .replace(/\s*\.\s*\.\s*/g, '. ') // Fix multiple dots
      .replace(/\s*\.\s+/g, '. ')      // Normalize spaces after dots
      .replace(/\s+/g, ' ')            // Normalize spaces
      .replace(/\s+([,.])/g, '$1')     // Fix spaces before punctuation
      .replace(/\s*\?\s*/g, '? ')      // Normalize question marks
      .replace(/\s*!\s*/g, '! ')       // Normalize exclamation marks
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

    // Process each transcript text
    const processedTranscripts = transcripts
      .map(transcript => this.decodeHTML(transcript.text))
      .filter(text => text.length > 0);

    if (!enableParagraphs) {
      // Simple concatenation mode with normalized formatting
      return this.normalizeText(processedTranscripts.join(' '));
    }

    // Paragraph mode
    const paragraphs: string[] = [];
    let currentParagraph: string[] = [];
    let lastEndTime = 0;

    for (let i = 0; i < transcripts.length; i++) {
      const transcript = transcripts[i];
      const text = this.decodeHTML(transcript.text.trim());
      if (!text) continue;

      const timeGap = transcript.timestamp - lastEndTime;
      const previousText = currentParagraph[currentParagraph.length - 1] || '';

      const shouldStartNewParagraph = 
        timeGap > timeGapThreshold ||
        (previousText.endsWith('.') && /^[A-Z]/.test(text)) ||
        currentParagraph.length >= maxSentencesPerParagraph;

      if (shouldStartNewParagraph && currentParagraph.length > 0) {
        paragraphs.push(this.normalizeText(currentParagraph.join(' ')));
        currentParagraph = [];
      }

      currentParagraph.push(text);
      lastEndTime = transcript.timestamp + transcript.duration;
    }

    if (currentParagraph.length > 0) {
      paragraphs.push(this.normalizeText(currentParagraph.join(' ')));
    }

    return paragraphs.join('\n\n');
  }
}

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
      const data = await response.json();
      return YouTubeUtils.decodeHTML(data.title);
    } catch (error) {
      console.error(`Failed to fetch video title: ${error}`);
      return 'Untitled Video';
    }
  }

  /**
   * Fetch transcript configuration from YouTube video page
   */
  private static async fetchTranscriptConfig(videoId: string, lang?: string): Promise<{ baseUrl: string, languageCode: string }> {
    const response = await fetch(`https://www.youtube.com/watch?v=${videoId}`, {
      headers: {
        ...(lang && { 'Accept-Language': lang }),
        'User-Agent': USER_AGENT
      }
    });

    const html = await response.text();
    const splittedHTML = html.split('"captions":');

    if (splittedHTML.length <= 1) {
      if (html.includes('class="g-recaptcha"')) {
        throw new YouTubeTranscriptError('Too many requests');
      }
      if (!html.includes('"playabilityStatus":')) {
        throw new YouTubeTranscriptError(`Video ${videoId} is unavailable`);
      }
      throw new YouTubeTranscriptError(`Transcripts are disabled for video ${videoId}`);
    }

    try {
      const transcriptData = JSON.parse(splittedHTML[1].split(',"videoDetails')[0].replace('\n', ''));
      const transcripts = transcriptData?.playerCaptionsTracklistRenderer;

      if (!transcripts || !('captionTracks' in transcripts)) {
        throw new YouTubeTranscriptError(`No transcripts available for video ${videoId}`);
      }

      const tracks = transcripts.captionTracks as { languageCode: string; baseUrl: string }[];
      if (lang && !tracks.some((track) => track.languageCode === lang)) {
        const availableLangs = tracks.map((track) => track.languageCode);
        throw new YouTubeTranscriptError(
          `Language ${lang} not available for video ${videoId}. Available languages: ${availableLangs.join(', ')}`
        );
      }

      const selectedTrack = lang
        ? tracks.find((track) => track.languageCode === lang)
        : tracks[0];

      if (!selectedTrack) {
        throw new YouTubeTranscriptError(`Could not find transcript track for video ${videoId}`);
      }

      return {
        baseUrl: selectedTrack.baseUrl,
        languageCode: selectedTrack.languageCode
      };
    } catch (error) {
      if (error instanceof YouTubeTranscriptError) {
        throw error;
      }
      throw new YouTubeTranscriptError(`Failed to parse transcript data: ${(error as Error).message}`);
    }
  }

  /**
   * Fetch and parse transcripts from the transcript URL
   */
  private static async fetchAndParseTranscripts(
    url: string,
    lang: string
  ): Promise<Transcript[]> {
    const response = await fetch(url, {
      headers: {
        ...(lang && { 'Accept-Language': lang }),
        'User-Agent': USER_AGENT
      }
    });

    if (!response.ok) {
      throw new YouTubeTranscriptError(`Failed to fetch transcript data (HTTP ${response.status})`);
    }

    const xml = await response.text();
    const results: Transcript[] = [];
    
    // Use regex to parse XML
    const regex = /<text start="([^"]+)" dur="([^"]+)"[^>]*>([^<]*)<\/text>/g;
    let match;
    
    while ((match = regex.exec(xml)) !== null) {
      const start = parseFloat(match[1]);
      const duration = parseFloat(match[2]);
      const text = YouTubeUtils.decodeHTML(match[3]);
      
      // Only add non-empty transcripts
      if (text.trim()) {
        results.push({
          text: text.trim(),
          lang,
          timestamp: start,     // Already in seconds
          duration: duration    // Already in seconds
        });
      }
    }

    // Sort by time
    return results.sort((a, b) => a.timestamp - b.timestamp);
  }

  /**
   * Extract video ID from YouTube URL or direct ID input
   */
  static extractVideoId(input: string): string {
    if (!input) {
      throw new McpError(
        ErrorCode.InvalidParams,
        'YouTube URL or ID is required'
      );
    }

    // If input is an 11-digit video ID
    if (/^[a-zA-Z0-9_-]{11}$/.test(input)) {
      return input;
    }

    // Handle URL formats
    try {
      const url = new URL(input);
      if (url.hostname === 'youtu.be') {
        return url.pathname.slice(1);
      } else if (url.hostname.includes('youtube.com')) {
        // Handle shorts URL format
        if (url.pathname.startsWith('/shorts/')) {
          return url.pathname.slice(8);
        }
        const videoId = url.searchParams.get('v');
        if (!videoId) {
          throw new McpError(
            ErrorCode.InvalidParams,
            `Invalid YouTube URL: ${input}`
          );
        }
        return videoId;
      }
    } catch (error) {
      // URL parsing failed, try regex matching
      const match = input.match(/(?:youtube\.com\/(?:[^/]+\/.+\/|(?:v|e(?:mbed)?)\/|.*[?&]v=)|youtu\.be\/)([^"&?/\s]{11})/);
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
  static async fetchTranscripts(videoId: string, config?: { lang?: string }): Promise<{ transcripts: Transcript[], title: string }> {
    try {
      const identifier = this.extractVideoId(videoId);
      const [{ baseUrl, languageCode }, title] = await Promise.all([
        this.fetchTranscriptConfig(identifier, config?.lang),
        this.fetchVideoTitle(identifier)
      ]);
      
      const transcripts = await this.fetchAndParseTranscripts(baseUrl, languageCode);
      return { transcripts, title };
    } catch (error) {
      if (error instanceof YouTubeTranscriptError || error instanceof McpError) {
        throw error;
      }
      throw new YouTubeTranscriptError(`Failed to fetch transcripts: ${(error as Error).message}`);
    }
  }
} 