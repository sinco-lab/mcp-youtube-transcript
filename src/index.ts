#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { McpError } from "@modelcontextprotocol/sdk/types.js";
import { YouTubeTranscriptFetcher, YouTubeUtils, YouTubeTranscriptError, TranscriptOptions, Transcript } from './youtube.js';
import { z } from "zod";

const SERVER_VERSION = "0.0.12";

type TranscriptInput = {
  url: string;
  lang?: string;
  enableParagraphs?: boolean;
};

type VideoInput = {
  url: string;
};

const getTranscriptsInputSchema: any = z.object({
  url: z.string().describe("YouTube video URL or ID"),
  lang: z.string().optional().describe("Optional language code for transcripts (e.g. 'en', 'uk', 'ja', 'ru', 'zh')"),
  enableParagraphs: z.boolean().default(false).describe("Enable automatic paragraph breaks, default `false`")
});

const videoInputSchema: any = z.object({
  url: z.string().describe("YouTube video URL or ID")
});

class YouTubeTranscriptExtractor {
  /**
   * Extracts YouTube video ID from various URL formats or direct ID input
   */
  extractYoutubeId(input: string): string {
    return YouTubeTranscriptFetcher.extractVideoId(input);
  }

  /**
   * Retrieves transcripts for a given video ID and language
   */
  async getTranscripts({ videoID, lang }: TranscriptOptions): Promise<{ transcripts: Transcript[], title: string, language: string, source: string }> {
    try {
      const result = await YouTubeTranscriptFetcher.fetchTranscripts(videoID, { lang });
      if (result.transcripts.length === 0) {
        throw new YouTubeTranscriptError('No transcripts found');
      }
      return result;
    } catch (error) {
      if (error instanceof YouTubeTranscriptError || error instanceof McpError) {
        throw error;
      }
      throw new YouTubeTranscriptError(`Failed to fetch transcripts: ${(error as Error).message}`);
    }
  }

  async getAvailableLanguages(url: string) {
    const videoId = this.extractYoutubeId(url);
    return YouTubeTranscriptFetcher.fetchAvailableLanguages(videoId);
  }

  async getVideoInfo(url: string) {
    const videoId = this.extractYoutubeId(url);
    return YouTubeTranscriptFetcher.fetchVideoInfo(videoId);
  }
}

class TranscriptServer {
  private extractor: YouTubeTranscriptExtractor;
  private server: McpServer;

  constructor() {
    this.extractor = new YouTubeTranscriptExtractor();
    this.server = new McpServer({
      name: "mcp-youtube-transcript",
      version: SERVER_VERSION,
      description: "A server built on the Model Context Protocol (MCP) that enables direct downloading of YouTube video transcripts, supporting AI and video analysis workflows."
    });

    this.setupTools();
    this.setupErrorHandling();
  }

  private setupErrorHandling(): void {
    process.on('SIGINT', async () => {
      await this.stop();
      process.exit(0);
    });
  }

  private setupTools(): void {
    const registerTranscriptTool = (name: string, description: string) => {
      this.server.registerTool(
        name,
        {
          description,
          inputSchema: getTranscriptsInputSchema
        },
        async (input: unknown) => this.handleTranscriptRequest(input, { includeTimestamps: false })
      );
    };

    registerTranscriptTool(
      "get_transcripts",
      `Extract and process transcripts from a YouTube video.\n\n**Parameters:**\n- \`url\` (string, required): YouTube video URL or ID.\n- \`lang\` (string, optional): Language code for transcripts (e.g. 'en', 'uk', 'ja', 'ru', 'zh'). If omitted, the best available caption track is used.\n- \`enableParagraphs\` (boolean, optional, default false): Enable automatic paragraph breaks.\n\n**IMPORTANT:** If the user does *not* specify a language *code*, **DO NOT** include the \`lang\` parameter in the tool call. Do not guess the language or use parts of the user query as the language code.`
    );

    registerTranscriptTool(
      "get_transcript",
      `Alias of \`get_transcripts\` for compatibility with other YouTube transcript MCP servers. Extract and process transcripts from a YouTube video.\n\n**Parameters:**\n- \`url\` (string, required): YouTube video URL or ID.\n- \`lang\` (string, optional): Language code for transcripts. If omitted, the best available caption track is used.\n- \`enableParagraphs\` (boolean, optional, default false): Enable automatic paragraph breaks.\n\n**IMPORTANT:** If the user does *not* specify a language *code*, **DO NOT** include the \`lang\` parameter in the tool call.`
    );

    this.server.registerTool(
      "get_timed_transcript",
      {
        description: `Extract a timestamped transcript from a YouTube video. Use this when the user needs quotes, chapter-like notes, or time-coded references.\n\n**Parameters:**\n- \`url\` (string, required): YouTube video URL or ID.\n- \`lang\` (string, optional): Language code for transcripts. If omitted, the best available caption track is used.`,
        inputSchema: getTranscriptsInputSchema
      },
      async (input: unknown) => this.handleTranscriptRequest(input, { includeTimestamps: true })
    );

    this.server.registerTool(
      "get_video_info",
      {
        description: "Fetch basic YouTube video metadata and available transcript languages without returning the full transcript.",
        inputSchema: videoInputSchema
      },
      async (input: unknown) => {
        const params = input as VideoInput;
        try {
          const info = await this.extractor.getVideoInfo(params.url);
          return {
            content: [{
              type: "text" as const,
              text: JSON.stringify(info, null, 2),
              _meta: info
            }]
          };
        } catch (error) {
          if (error instanceof YouTubeTranscriptError || error instanceof McpError) {
            throw error;
          }
          throw new YouTubeTranscriptError(`Failed to get video info: ${(error as Error).message}`);
        }
      }
    );

    this.server.registerTool(
      "get_available_languages",
      {
        description: "List available transcript languages for a YouTube video. Use this before retrying with a specific language code.",
        inputSchema: videoInputSchema
      },
      async (input: unknown) => {
        const params = input as VideoInput;
        try {
          const result = await this.extractor.getAvailableLanguages(params.url);
          return {
            content: [{
              type: "text" as const,
              text: JSON.stringify(result, null, 2),
              _meta: result
            }]
          };
        } catch (error) {
          if (error instanceof YouTubeTranscriptError || error instanceof McpError) {
            throw error;
          }
          throw new YouTubeTranscriptError(`Failed to get available languages: ${(error as Error).message}`);
        }
      }
    );
  }

  private async handleTranscriptRequest(
    input: unknown,
    options: { includeTimestamps: boolean }
  ) {
    const params = input as TranscriptInput;
    try {
      const videoId = this.extractor.extractYoutubeId(params.url);
      console.error(`Processing transcripts for video: ${videoId}`);

      const { transcripts, title, language, source } = await this.extractor.getTranscripts({
        videoID: videoId,
        lang: params.lang
      });

      const formattedText = options.includeTimestamps
        ? YouTubeUtils.formatTimedTranscriptText(transcripts)
        : YouTubeUtils.formatTranscriptText(transcripts, {
            enableParagraphs: params.enableParagraphs
          });

      console.error(`Successfully extracted ${language} transcripts via ${source} for "${title}" (${formattedText.length} chars)`);

      return {
        content: [{
          type: "text" as const,
          text: `# ${title}\n\n${formattedText}`,
          _meta: {
            videoId,
            title,
            language,
            source,
            timestamp: new Date().toISOString(),
            charCount: formattedText.length,
            transcriptCount: transcripts.length,
            totalDuration: YouTubeUtils.calculateTotalDuration(transcripts),
            paragraphsEnabled: options.includeTimestamps ? false : params.enableParagraphs ?? false,
            timestampsIncluded: options.includeTimestamps
          }
        }]
      };
    } catch (error) {
      if (error instanceof YouTubeTranscriptError || error instanceof McpError) {
        throw error;
      }
      throw new YouTubeTranscriptError(`Failed to process transcripts: ${(error as Error).message}`);
    }
  }

  async start(): Promise<void> {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
  }

  async stop(): Promise<void> {
    await this.server.close();
  }
}

async function main() {
  try {
    const server = new TranscriptServer();
    await server.start();
  } catch (error) {
    console.error('Server error:', error);
    process.exit(1);
  }
}

main();
