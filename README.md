# MCP YouTube Transcript Server

A Model Context Protocol server that enables retrieval of transcripts from YouTube videos. This server provides direct access to video transcripts through a simple interface, making it ideal for content analysis and processing.

<a href="https://glama.ai/mcp/servers/@sinco-lab/mcp-youtube-transcript">
  <img width="380" height="200" src="https://glama.ai/mcp/servers/@sinco-lab/mcp-youtube-transcript/badge" alt="mcp-youtube-transcript" />
</a>

## Table of Contents
- [Features](#features)
- [Getting Started](#getting-started)
  - [Prerequisites](#prerequisites)
  - [Installation](#installation)
- [Usage](#usage)
  - [Basic Configuration](#basic-configuration)
  - [Testing](#testing)
  - [Troubleshooting and Maintenance](#troubleshooting-and-maintenance)
- [API Reference](#api-reference)
- [Development](#development)
- [Contributing](#contributing)
- [License](#license)

## Features

✨ Key capabilities:
- Extract transcripts from YouTube videos
- Support for multiple languages
- Android InnerTube fallback for current YouTube caption responses
- Format text with continuous or paragraph mode
- Retrieve video titles and metadata
- Automatic paragraph segmentation
- Text normalization and HTML entity decoding
- Robust error handling
- Timestamp and overlap detection

## Getting Started

### Prerequisites

- Node.js 18 or higher

### Installation

Use a local `npx` configuration so transcript requests are sent from your own machine instead of a remote MCP proxy.

1. Create or edit the Claude Desktop configuration file:
   - macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`
   - Windows: `%APPDATA%\Claude\claude_desktop_config.json`

2. Add the following configuration:

```json
{
  "mcpServers": {
    "youtube-transcript": {
      "command": "npx",
      "args": [
        "-y",
        "@sinco-lab/mcp-youtube-transcript"
      ]
    }
  }
}
```

Quick setup script for macOS:

```bash
# Create directory if it doesn't exist
mkdir -p ~/Library/Application\ Support/Claude

# Create or update config file
cat > ~/Library/Application\ Support/Claude/claude_desktop_config.json << 'EOL'
{
  "mcpServers": {
    "youtube-transcript": {
      "command": "npx",
      "args": [
        "-y",
        "@sinco-lab/mcp-youtube-transcript"
      ]
    }
  }
}
EOL
```

## Usage

### Basic Configuration

To use with Claude Desktop / Cursor / cline, ensure your configuration matches:

```json
{
  "mcpServers": {
    "youtube-transcript": {
      "command": "npx",
      "args": ["-y", "@sinco-lab/mcp-youtube-transcript"]
    }
  }
}
```

### Testing

#### With Claude App

1. Restart the Claude app after installation
2. Test with a simple command:
   ```plaintext
   https://www.youtube.com/watch?v=AJpK3YTTKZ4 Summarize this video
   ```

Example output:
![Demo](./assets/demo.png)

#### With MCP Inspector

```bash
# Clone and setup
git clone https://github.com/sinco-lab/mcp-youtube-transcript.git
cd mcp-youtube-transcript
npm install
npm run build

# Launch inspector
npx @modelcontextprotocol/inspector node "dist/index.js"

# Access http://localhost:6274 and try these commands:
# 1. List Tools: clink `List Tools`
# 2. Test get_transcripts with:
#    url: "https://www.youtube.com/watch?v=AJpK3YTTKZ4"
#    lang: "en" (optional; omit to use the best available caption track)
#    enableParagraphs: false (optional)
```

### Troubleshooting and Maintenance

#### Checking Claude Logs

To monitor Claude's logs, you can use the following command:

```bash
tail -n 20 -f ~/Library/Logs/Claude/mcp*.log
```

This will display the last 20 lines of the log file and continue to show new entries as they are added.

> **Note**: Claude app automatically prefixes MCP server log files with `mcp-server-`. For example, our server's logs will be written to `mcp-server-youtube-transcript.log`.

#### Cleaning the `npx` Cache

If you encounter issues related to the `npx` cache, you can manually clean it using:

```bash
rm -rf ~/.npm/_npx
```

This will remove the cached packages and allow you to start fresh.

## API Reference

### get_transcripts

Fetches transcripts from YouTube videos.

**Parameters:**
- `url` (string, required): YouTube video URL or ID
- `lang` (string, optional): Language code. If omitted, the best available caption track is used.
- `enableParagraphs` (boolean, optional): Enable paragraph mode (default: false)

**Response Format:**
```json
{
  "content": [{
    "type": "text",
    "text": "Video title and transcript content",
    "_meta": {
      "videoId": "video_id",
      "title": "video_title",
      "language": "transcript_language",
      "source": "innertube",
      "timestamp": "processing_time",
      "charCount": "character_count",
      "transcriptCount": "number_of_transcripts",
      "totalDuration": "total_duration",
      "paragraphsEnabled": "paragraph_mode_status"
    }
  }]
}
```

## Development

### Project Structure

```
├── src/
│ ├── index.ts            # Server entry point
│ ├── youtube.ts          # YouTube transcript fetching logic
├── dist/                 # Compiled output
└── package.json
```

### Key Components

- `YouTubeTranscriptFetcher`: Core transcript fetching functionality
- `YouTubeUtils`: Text processing and utilities

### Features and Capabilities

- **Error Handling:**
  - Invalid URLs/IDs
  - Unavailable transcripts
  - Language availability
  - Network errors
  - Rate limiting
  - Empty caption responses caused by YouTube client enforcement

- **Text Processing:**
  - HTML entity decoding
  - Punctuation normalization
  - Space normalization
  - `srv3`, classic XML, `json3`, and VTT caption parsing
  - Smart paragraph detection

### YouTube Access Notes

YouTube does not provide an official public API for downloading captions from arbitrary videos. This server uses YouTube's internal caption data exposed to web and Android clients. YouTube may still reject requests from some networks, hosted environments, or remote MCP providers. When that happens, the server now returns a more specific diagnostic instead of a generic `No transcripts found` error.

## Contributing

We welcome contributions! Please feel free to submit issues and pull requests.

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## Related Projects

- [mcp-servers](https://github.com/modelcontextprotocol/servers)
- [MCP Inspector](https://github.com/modelcontextprotocol/inspector)
