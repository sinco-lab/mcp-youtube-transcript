# MCP YouTube Transcript Server

A TypeScript Model Context Protocol server that retrieves YouTube transcripts for Claude Desktop, Cursor, Cline, Codex, and other MCP-compatible clients. It is designed for local `npx` usage so transcript requests are made from your own machine instead of a remote proxy.

[![npm version](https://img.shields.io/npm/v/@sinco-lab/mcp-youtube-transcript.svg)](https://www.npmjs.com/package/@sinco-lab/mcp-youtube-transcript)
[![npm downloads](https://img.shields.io/npm/dm/@sinco-lab/mcp-youtube-transcript.svg)](https://www.npmjs.com/package/@sinco-lab/mcp-youtube-transcript)
[![GitHub stars](https://img.shields.io/github/stars/sinco-lab/mcp-youtube-transcript?style=social)](https://github.com/sinco-lab/mcp-youtube-transcript)
[![License: MIT](https://img.shields.io/badge/license-MIT-green.svg)](./LICENSE)

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
  - [Docker](#docker)
  - [Testing](#testing)
  - [Troubleshooting and Maintenance](#troubleshooting-and-maintenance)
- [Tools](#tools)
- [Development](#development)
- [Contributing](#contributing)
- [License](#license)

## Features

Key capabilities:
- Extract transcripts from YouTube videos
- Support for multiple languages
- Android InnerTube fallback for current YouTube caption responses
- Compatible tool names: `get_transcripts` and `get_transcript`
- Timestamped transcript output with `get_timed_transcript`
- Video metadata and available transcript languages
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

### Docker

The repository includes a production Dockerfile for local container usage:

```bash
docker build -t mcp-youtube-transcript .
```

MCP client configuration:

```json
{
  "mcpServers": {
    "youtube-transcript": {
      "command": "docker",
      "args": ["run", "--rm", "-i", "mcp-youtube-transcript"]
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

## Tools

### get_transcripts

Fetches transcript text from a YouTube video.

Parameters:
- `url` (string, required): YouTube video URL or ID
- `lang` (string, optional): Language code. If omitted, the best available caption track is used.
- `enableParagraphs` (boolean, optional): Enable paragraph mode. Default: `false`.

### get_transcript

Alias of `get_transcripts` for compatibility with other YouTube transcript MCP servers.

### get_timed_transcript

Fetches transcript text with one timestamped line per caption segment.

Parameters:
- `url` (string, required): YouTube video URL or ID
- `lang` (string, optional): Language code. If omitted, the best available caption track is used.

Example output:

```text
[00:00:01.250] Hello and welcome
[00:00:03.500] Today we are going to...
```

### get_video_info

Fetches basic video metadata and available transcript languages without returning the full transcript.

Parameters:
- `url` (string, required): YouTube video URL or ID

### get_available_languages

Lists available transcript languages for a YouTube video. Use this before retrying with a specific `lang` value.

Parameters:
- `url` (string, required): YouTube video URL or ID

## Development

### Project Structure

```
├── src/
│ ├── index.ts            # Server entry point
│ ├── youtube.ts          # YouTube transcript fetching logic
├── tests/                # Node test runner coverage
├── docs/                 # Maintenance notes
├── Dockerfile            # Local container build
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
