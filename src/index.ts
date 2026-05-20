#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { McpError } from "@modelcontextprotocol/sdk/types.js";
import { YouTubeTranscriptFetcher, YouTubeUtils, YouTubeTranscriptError, TranscriptOptions, Transcript } from './youtube.js';
import { z } from "zod";

type GetTranscriptsInput = {
  url: string;
  lang?: string;
  enableParagraphs?: boolean;
};

const getTranscriptsInputSchema: any = z.object({
  url: z.string().describe("YouTube video URL or ID"),
  lang: z.string().optional().describe("Optional language code for transcripts (e.g. 'en', 'uk', 'ja', 'ru', 'zh')"),
  enableParagraphs: z.boolean().default(false).describe("Enable automatic paragraph breaks, default `false`")
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
}

class TranscriptServer {
  private extractor: YouTubeTranscriptExtractor;
  private server: McpServer;

  constructor() {
    this.extractor = new YouTubeTranscriptExtractor();
    this.server = new McpServer({
      name: "mcp-youtube-transcript",
      version: "0.0.8",
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
    this.server.registerTool(
      "get_transcripts",
      {
        description: `Extract and process transcripts from a YouTube video.\n\n**Parameters:**\n- \`url\` (string, required): YouTube video URL or ID.\n- \`lang\` (string, optional): Language code for transcripts (e.g. 'en', 'uk', 'ja', 'ru', 'zh'). If omitted, the best available caption track is used.\n- \`enableParagraphs\` (boolean, optional, default false): Enable automatic paragraph breaks.\n\n**IMPORTANT:** If the user does *not* specify a language *code*, **DO NOT** include the \`lang\` parameter in the tool call. Do not guess the language or use parts of the user query as the language code.`,
        inputSchema: getTranscriptsInputSchema
      },
      async (input: unknown) => {
        const params = input as GetTranscriptsInput;
        try {
          const videoId = this.extractor.extractYoutubeId(params.url);
          console.error(`Processing transcripts for video: ${videoId}`);
          
          const { transcripts, title, language, source } = await this.extractor.getTranscripts({
            videoID: videoId,
            lang: params.lang
          });
          
          // Format text with optional paragraph breaks
          const formattedText = YouTubeUtils.formatTranscriptText(transcripts, {
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
                paragraphsEnabled: params.enableParagraphs ?? false
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
    );
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
